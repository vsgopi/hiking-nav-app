/**
 * Phase 2: ingests complete OSM (OpenStreetMap) geometry for the full Te
 * Araroa route (both islands) and slices it to the 94 official 2026-27
 * sections, using the Trust's own Section Routes GPX only as an in-memory
 * boundary reference (never stored, never bundled — see scripts/lib/trustBoundaries.ts).
 *
 * Run with: npm run ingest:trail
 *
 * Te Araroa is modeled in OSM as a relation hierarchy: two island superroutes
 * (North Island 8518624, South Island 8518626) -> ~10 numbered regional
 * relations -> lettered leaf route relations containing ordered `way`
 * members (some regions, e.g. Otago/Southland, are already leaves at the
 * regional tier). Separate relations named "...alternative..." or ref
 * "TAalt*" are bypasses, not part of the main through-route. Relation
 * 11025812 ("Te Araroa Links, Alternates and Services") is metadata
 * (accommodation/resupply points), not path geometry, and is excluded.
 *
 * Pipeline (see the Phase 2 design conversation for the full rationale):
 *   raw OSM -> stitch/orient (per region) -> regional validation ->
 *   whole-island assembly (+ chain-following orientation) -> simplify ->
 *   boundary matching (Trust GPX anchors, OSM-only search space) ->
 *   part-aware slicing -> dedupe -> final validation -> length calculation.
 *
 * Every stored geometry is 100% OSM coordinates. Trust GPX boundary
 * coordinates exist only in memory during this run and are never written to
 * assets/ or to the validation report.
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import simplify from '@turf/simplify';
import { lineString } from '@turf/helpers';
import { lineStringLengthKm } from '../src/shared/utils/geo';
import type { GeoLineString, GeoMultiLineString } from '../src/domain/models/TrailGeometry';
import { SECTION_SEEDS, SECTION_REGION_SEEDS } from '../src/core/database/seedData/officialSections2026_27';
import { assembleIslandLine, type RegionInput } from './lib/islandAssembly';
import {
  matchBypassSection,
  resolveMainSectionBoundaries,
  type BypassSectionInput,
  type MainSectionInput,
} from './lib/boundaryMatching';
import { dedupeGeometry, sliceBetweenCuts } from './lib/sectionSlicing';
import { computeLengthKm } from './lib/finalValidation';
import { extractSectionBoundaries, fetchAndExtractTrustZip } from './lib/trustBoundaries';
import { checkLengthConfidence, findIntervalOverlaps, type ResolvedInterval } from './lib/matchConfidence';
import { determineIslandFromMetadata, resolveAmbiguousIsland } from './lib/islandSelection';
import { classifyMainSectionPreflight } from './lib/sectionPreflight';
import type { BypassCandidate, Coord, Part, SectionGeometryResult } from './lib/types';

/**
 * Maps each OSM regional relation to the Phase 1 canonical region id(s) it
 * covers — established by direct inspection during the Phase 2.1 diagnostic
 * pass (relation "04 Manawatū-Whanganui" is a single OSM relation covering
 * two canonical Trust regions). Used only to mark sections whose own region
 * already failed OSM validation as `source_region_failed` up front, instead
 * of attempting (and wastefully failing) a boundary match against data that
 * was already excluded. If OSM ever renumbers these relations, a region
 * whose id isn't in this table is caught explicitly (see the assertion in
 * `main`) rather than silently mismatched.
 */
const OSM_REGION_TO_CANONICAL: Record<number, string[]> = {
  9581690: ['northland'],
  9591890: ['auckland'],
  9623302: ['waikato'],
  9631596: ['whanganui', 'manawatu'],
  9551588: ['wellington'],
  19440380: ['marlborough'],
  10992547: ['tasman'],
  10992548: ['canterbury'],
  10992549: ['otago'],
  10992550: ['southland'],
};

// Falls back to process.cwd() when import.meta.url isn't populated (jest's
// babel/CJS transform, used when this file's pure functions are imported by
// tests, doesn't provide a real ESM import.meta) — only the CLI entry point
// actually depends on this being the script's real directory; the pure
// functions tested under jest never touch CACHE_DIR/ASSETS_DIR/REPORT_DIR.
export const __dirname = import.meta.url ? dirname(fileURLToPath(import.meta.url)) : process.cwd();
export const CACHE_DIR = join(__dirname, '.cache');
const ASSETS_DIR = join(__dirname, '..', 'assets', 'seed');
const REPORT_DIR = join(__dirname, '.out');
// Git-ignored, never assets/ — see scripts/lib/trustBoundaries.ts.
const TRUST_SCRATCH_DIR = join(__dirname, '.cache-trust-boundaries');
const TRUST_ZIP_URL = 'https://www.teararoa.org.nz/wp-content/uploads/2026/06/TeAraroaTrail_Section_Routes_2026_27_GPX.zip';

// Mirrors tried in order; the free public overpass-api.de instance is
// frequently rate-limited/flaky for the larger `out geom` way queries, so a
// run that exhausts retries against one endpoint moves to the next rather
// than failing outright.
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const NORTH_ISLAND_RELATION_ID = 8518624;
const SOUTH_ISLAND_RELATION_ID = 8518626;
const LINKS_ALTERNATES_SERVICES_RELATION_ID = 11025812; // metadata, not path geometry

export const IMPORTED_AT = new Date().toISOString().slice(0, 10);
export const OSM_SOURCE_ID = 'osm';

// NZ bounding sanity range, used both to validate and as a coarse import filter.
export const NZ_LON_RANGE: [number, number] = [166, 179];
export const NZ_LAT_RANGE: [number, number] = [-47, -34];

export const MAX_JUMP_WITHIN_FEATURE_KM = 2;
const STITCH_GAP_WARN_METERS = 15;
/** Beyond this, treat a stitching gap as a real discontinuity (new MultiLineString part) rather than joining ways across it. */
const STITCH_SPLIT_THRESHOLD_METERS = 300;
const LENGTH_WARN_TOLERANCE = 0.15;
const LENGTH_FAIL_TOLERANCE = 0.4;
const SIMPLIFY_TOLERANCE_DEGREES = 0.00005; // ~5m, unchanged from the original ingest

/** Configurable, not hard-coded — see the Phase 2 design's matching safeguards. Override via BOUNDARY_THRESHOLD_METERS env var to retune after seeing real match distances. */
export const DEFAULT_BOUNDARY_THRESHOLD_METERS = Number(process.env.BOUNDARY_THRESHOLD_METERS ?? 200);
export const DEFAULT_SHARED_BOUNDARY_TOLERANCE_METERS = Number(process.env.SHARED_BOUNDARY_TOLERANCE_METERS ?? 5);

export interface OverpassMember {
  type: 'node' | 'way' | 'relation';
  ref: number;
  role: string;
}

export interface OverpassRelation {
  type: 'relation';
  id: number;
  tags?: Record<string, string>;
  members: OverpassMember[];
}

export interface OverpassWay {
  type: 'way';
  id: number;
  geometry?: { lat: number; lon: number }[];
}

let requestCount = 0;

export async function overpassQuery<T>(query: string, cacheKey: string): Promise<T> {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  const cachePath = join(CACHE_DIR, `${cacheKey}.json`);
  if (existsSync(cachePath)) {
    return JSON.parse(readFileSync(cachePath, 'utf-8')) as T;
  }

  const maxAttempts = 12;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    requestCount += 1;
    if (requestCount > 1) {
      await new Promise((resolve) => setTimeout(resolve, 3000)); // be polite to the free public endpoint
    }

    // Alternate mirrors across attempts, so a run doesn't burn its whole
    // retry budget hammering one endpoint that's currently unreachable.
    const url = OVERPASS_URLS[(attempt - 1) % OVERPASS_URLS.length];

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: '*/*',
          'User-Agent': 'hiking-nav-app-ingest/1.0 (dev tooling)',
        },
        body: 'data=' + encodeURIComponent(query),
        // Overpass can hang without erroring or responding under load; without
        // this a stalled connection would block the whole ingest indefinitely.
        signal: AbortSignal.timeout(90_000),
      });
    } catch (error) {
      const backoffMs = 5000 * attempt;
      console.warn(
        `  [warn] Overpass (${url}) network error (${(error as Error).message}), retrying in ${backoffMs / 1000}s (attempt ${attempt}/${maxAttempts})`,
      );
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      continue;
    }
    const text = await response.text();

    if ([429, 500, 502, 503, 504].includes(response.status)) {
      const backoffMs = 5000 * attempt;
      console.warn(`  [warn] Overpass (${url}) ${response.status}, retrying in ${backoffMs / 1000}s (attempt ${attempt}/${maxAttempts})`);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      continue;
    }
    if (response.status !== 200) {
      throw new Error(`Overpass request failed (${response.status}): ${text.slice(0, 500)}`);
    }
    const data = JSON.parse(text) as T;
    writeFileSync(cachePath, JSON.stringify(data));
    return data;
  }
  throw new Error(`Overpass request failed after ${maxAttempts} attempts (rate limited)`);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function fetchRelations(ids: number[]): Promise<Map<number, OverpassRelation>> {
  const result = new Map<number, OverpassRelation>();
  for (const idBatch of chunk(ids, 180)) {
    const key = `rel-${idBatch[0]}-${idBatch.length}`;
    const data = await overpassQuery<{ elements: OverpassRelation[] }>(
      `[out:json][timeout:180];rel(id:${idBatch.join(',')});out body;`,
      key,
    );
    for (const el of data.elements) result.set(el.id, el);
  }
  return result;
}

export async function fetchWaysGeometry(ids: number[]): Promise<Map<number, Part>> {
  const result = new Map<number, Part>();
  for (const idBatch of chunk(ids, 100)) {
    const key = `way-${idBatch[0]}-${idBatch.length}`;
    const data = await overpassQuery<{ elements: OverpassWay[] }>(
      `[out:json][timeout:180];way(id:${idBatch.join(',')});out geom;`,
      key,
    );
    for (const el of data.elements) {
      if (!el.geometry) continue;
      result.set(
        el.id,
        el.geometry.map((pt) => [pt.lon, pt.lat] as Coord),
      );
    }
  }
  return result;
}

/** Recursively resolves a relation to its ordered leaf `way` ids, regardless of nesting depth. */
export async function resolveToWayIds(
  relationId: number,
  relations: Map<number, OverpassRelation>,
  depth = 0,
): Promise<number[]> {
  if (depth > 6) throw new Error(`Relation ${relationId} nests too deep (>6) — likely a cycle`);
  const relation = relations.get(relationId);
  if (!relation) throw new Error(`Relation ${relationId} was not fetched`);

  const wayIds: number[] = [];
  for (const member of relation.members) {
    if (member.type === 'way') {
      wayIds.push(member.ref);
    } else if (member.type === 'relation') {
      wayIds.push(...(await resolveToWayIds(member.ref, relations, depth + 1)));
    }
  }
  return wayIds;
}

export function haversineMeters(a: Coord, b: Coord): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Stitches ordered way geometries via shared-endpoint matching. Real trail
 * data isn't always one continuous OSM way chain — road-walk sections,
 * beach crossings, and plain digitization gaps are common — so rather than
 * fabricating a connecting segment across a large gap (fake geometry) or
 * failing the whole region, a gap beyond STITCH_SPLIT_THRESHOLD_METERS
 * starts a new part. The result is multiple parts when a region has any
 * such internal gap, or a single part when it doesn't.
 */
export function stitchWaysIntoParts(wayCoords: Part[], label: string): Part[] {
  if (wayCoords.length === 0) return [];
  const parts: Part[] = [[...wayCoords[0]]];

  for (let i = 1; i < wayCoords.length; i++) {
    const next = wayCoords[i];
    const currentPart = parts[parts.length - 1];
    const partEnd = currentPart[currentPart.length - 1];
    const distToStart = haversineMeters(partEnd, next[0]);
    const distToEnd = haversineMeters(partEnd, next[next.length - 1]);
    const gap = Math.min(distToStart, distToEnd);
    const orientedNext = distToStart <= distToEnd ? next : [...next].reverse();

    if (gap > STITCH_SPLIT_THRESHOLD_METERS) {
      console.warn(
        `  [warn] ${label}: ${(gap / 1000).toFixed(1)}km gap at way index ${i} — starting a new part instead of joining`,
      );
      parts.push([...orientedNext]);
    } else {
      if (gap > STITCH_GAP_WARN_METERS) {
        console.warn(`  [warn] ${label}: ${Math.round(gap)}m gap stitching way index ${i}`);
      }
      currentPart.push(...orientedNext.slice(1));
    }
  }
  return parts;
}

export function parseDistanceKmTag(tags: Record<string, string> | undefined): number | null {
  const raw = tags?.distance;
  if (!raw) return null;
  const match = raw.match(/([\d.]+)/);
  return match ? parseFloat(match[1]) : null;
}

/** Validates one contiguous part: NZ coordinate range, and no leftover internal jump (parts are already split at real gaps by stitchWaysIntoParts, so this is a safety net for a corrupt way's own node order). */
export function validatePart(coords: Part, label: string): void {
  for (const [lon, lat] of coords) {
    if (lon < NZ_LON_RANGE[0] || lon > NZ_LON_RANGE[1] || lat < NZ_LAT_RANGE[0] || lat > NZ_LAT_RANGE[1]) {
      throw new Error(
        `${label}: coordinate [${lon}, ${lat}] is outside the expected NZ range — possible lat/lon swap or bad data`,
      );
    }
  }
  for (let i = 1; i < coords.length; i++) {
    const jumpKm = haversineMeters(coords[i - 1], coords[i]) / 1000;
    if (jumpKm > MAX_JUMP_WITHIN_FEATURE_KM) {
      throw new Error(
        `${label}: ${jumpKm.toFixed(1)}km jump between consecutive points at index ${i} — geometry rejected`,
      );
    }
  }
}

type LineOrMultiLine = GeoLineString | GeoMultiLineString;

/** A single part becomes a LineString; multiple (real internal gaps) become a MultiLineString — used only for the OSM-tag length cross-check below, not for storage. */
function partsToGeometry(parts: Part[]): LineOrMultiLine {
  if (parts.length === 1) {
    return { type: 'LineString', coordinates: parts[0] };
  }
  return { type: 'MultiLineString', coordinates: parts };
}

export function simplifyParts(parts: Part[]): Part[] {
  return parts.map(
    (part) =>
      simplify(lineString(part), { tolerance: SIMPLIFY_TOLERANCE_DEGREES, highQuality: true }).geometry
        .coordinates as Part,
  );
}

interface RegionResult {
  relationId: number;
  name: string;
  island: 'NI' | 'SI';
  sequence: number;
  parts: Part[];
}

interface RegionFailure {
  relationId: number;
  name: string;
  error: string;
}

/** Fetches, resolves, stitches and validates every NI+SI regional relation — the full run, no INGEST_REGION_IDS restriction. A region that fails validation is excluded and reported, not allowed to abort every other region's already-valid result. */
async function ingestAllRegions(): Promise<{ results: RegionResult[]; failures: RegionFailure[] }> {
  console.log('Discovering Te Araroa region hierarchy from OpenStreetMap...');
  const islands = await fetchRelations([NORTH_ISLAND_RELATION_ID, SOUTH_ISLAND_RELATION_ID]);
  const regionOrder: { id: number; island: 'NI' | 'SI'; sequence: number }[] = [];
  for (const [islandId, code] of [
    [NORTH_ISLAND_RELATION_ID, 'NI'] as const,
    [SOUTH_ISLAND_RELATION_ID, 'SI'] as const,
  ]) {
    const island = islands.get(islandId);
    if (!island) throw new Error(`Island superroute ${islandId} not found`);
    let seq = 0;
    for (const member of island.members) {
      if (member.type === 'relation') regionOrder.push({ id: member.ref, island: code, sequence: ++seq });
    }
  }
  console.log(`Found ${regionOrder.length} regions:`, regionOrder.map((r) => r.id).join(', '));

  // Dev affordance retained for fast smoke tests; the production/full run
  // (documented in the npm script and this file's own header) must not set
  // this — every region is ingested by default.
  const regionFilter = process.env.INGEST_REGION_IDS?.split(',').map((s: string) => Number(s.trim()));
  const filteredRegionOrder = regionFilter ? regionOrder.filter((r) => regionFilter.includes(r.id)) : regionOrder;
  if (regionFilter) {
    console.log(`INGEST_REGION_IDS set — restricting to ${filteredRegionOrder.length} region(s) (NOT a production run)`);
  }

  const regionRelations = await fetchRelations(filteredRegionOrder.map((r) => r.id));
  const regionWayIdLists = new Map<number, number[]>();
  const allRelationsNeeded = new Map<number, OverpassRelation>(regionRelations);

  let frontier = [...regionRelations.values()];
  while (frontier.length > 0) {
    const nextIds = new Set<number>();
    for (const rel of frontier) {
      for (const m of rel.members) {
        if (m.type === 'relation' && !allRelationsNeeded.has(m.ref)) nextIds.add(m.ref);
      }
    }
    if (nextIds.size === 0) break;
    const fetched = await fetchRelations([...nextIds]);
    for (const [id, rel] of fetched) allRelationsNeeded.set(id, rel);
    frontier = [...fetched.values()];
  }

  for (const region of filteredRegionOrder) {
    regionWayIdLists.set(region.id, await resolveToWayIds(region.id, allRelationsNeeded));
  }

  const allWayIds = [...new Set([...regionWayIdLists.values()].flat())];
  console.log(`Fetching geometry for ${allWayIds.length} main-route ways...`);
  const wayGeometries = await fetchWaysGeometry(allWayIds);

  const results: RegionResult[] = [];
  const failures: { relationId: number; name: string; error: string }[] = [];
  for (const region of filteredRegionOrder) {
    const rel = regionRelations.get(region.id)!;
    const name = rel.tags?.name ?? `region-${region.id}`;
    try {
      const wayIds = regionWayIdLists.get(region.id) ?? [];
      const coords = wayIds.map((id) => wayGeometries.get(id)).filter((c): c is Part => !!c);
      if (coords.length !== wayIds.length) {
        console.warn(`  [warn] region ${region.id} (${name}): ${wayIds.length - coords.length} ways missing geometry`);
      }

      const parts = stitchWaysIntoParts(coords, name);
      parts.forEach((part, partIndex) => validatePart(part, `${name} (part ${partIndex + 1}/${parts.length})`));

      const distanceKmOsm = parseDistanceKmTag(rel.tags);
      const computedKm = lineStringLengthKm(partsToGeometry(parts));
      if (distanceKmOsm !== null) {
        const diff = Math.abs(computedKm - distanceKmOsm) / distanceKmOsm;
        if (diff > LENGTH_FAIL_TOLERANCE) {
          throw new Error(
            `${name}: computed length ${computedKm.toFixed(1)}km differs from OSM tag ${distanceKmOsm}km by ${(diff * 100).toFixed(0)}% — rejected`,
          );
        }
        if (diff > LENGTH_WARN_TOLERANCE) {
          console.warn(`  [warn] ${name}: computed length ${computedKm.toFixed(1)}km vs OSM tag ${distanceKmOsm}km (${(diff * 100).toFixed(0)}% diff)`);
        }
      }
      console.log(`  ${name}: ${parts.reduce((s, p) => s + p.length, 0)} points, ${computedKm.toFixed(1)}km, ${parts.length} part(s)`);

      results.push({ relationId: region.id, name, island: region.island, sequence: region.sequence, parts });
    } catch (error) {
      // A single region's raw OSM data failing validation must not discard
      // every other region's already-successful, already-validated result —
      // it's excluded (any section whose Trust boundary falls in its area
      // will correctly fail to match and be flagged, never silently
      // approximated) and reported prominently, not swallowed.
      const message = (error as Error).message;
      console.error(`  [FAILED] ${name}: ${message}`);
      failures.push({ relationId: region.id, name, error: message });
    }
  }
  if (failures.length > 0) {
    console.error(`\n${failures.length} region(s) failed OSM validation and were excluded from this run:`);
    for (const f of failures) console.error(`  - ${f.name} (relation ${f.relationId}): ${f.error}`);
  }
  return { results, failures };
}

/** Same global alternate-relation search as before; now returns BypassCandidate[] for the matching module instead of writing a separate asset file. */
async function ingestBypassCandidates(mainRouteRelationIds: Set<number>): Promise<BypassCandidate[]> {
  console.log('Searching for alternate/bypass relations...');
  const alternateSearch = await overpassQuery<{ elements: OverpassRelation[] }>(
    '[out:json][timeout:180];rel["route"="hiking"]["name"~"Te Araroa"];out body;',
    'alternate-search',
  );
  const alternateRelations = alternateSearch.elements.filter((el) => {
    if (el.id === LINKS_ALTERNATES_SERVICES_RELATION_ID) return false;
    if (mainRouteRelationIds.has(el.id)) return false;
    const name = el.tags?.name ?? '';
    const ref = el.tags?.ref ?? '';
    return /alternative/i.test(name) || /^TAalt/i.test(ref);
  });
  console.log(`Found ${alternateRelations.length} alternate/bypass relations`);

  const allAlternateRelationsNeeded = new Map<number, OverpassRelation>(alternateRelations.map((r) => [r.id, r]));
  let altFrontier = alternateRelations;
  while (altFrontier.length > 0) {
    const nextIds = new Set<number>();
    for (const rel of altFrontier) {
      for (const m of rel.members) {
        if (m.type === 'relation' && !allAlternateRelationsNeeded.has(m.ref)) nextIds.add(m.ref);
      }
    }
    if (nextIds.size === 0) break;
    const fetched = await fetchRelations([...nextIds]);
    for (const [id, rel] of fetched) allAlternateRelationsNeeded.set(id, rel);
    altFrontier = [...fetched.values()];
  }

  const alternateWayIdLists = new Map<number, number[]>();
  for (const alt of alternateRelations) {
    alternateWayIdLists.set(alt.id, await resolveToWayIds(alt.id, allAlternateRelationsNeeded));
  }
  const allWayIds = [...new Set([...alternateWayIdLists.values()].flat())];
  console.log(`Fetching geometry for ${allWayIds.length} alternate-relation ways...`);
  const wayGeometries = await fetchWaysGeometry(allWayIds);

  const candidates: BypassCandidate[] = [];
  for (const alt of alternateRelations) {
    const wayIds = alternateWayIdLists.get(alt.id) ?? [];
    const coords = wayIds.map((id) => wayGeometries.get(id)).filter((c): c is Part => !!c);
    if (coords.length === 0) continue;
    const name = alt.tags?.name ?? `alternate-${alt.id}`;
    const parts = stitchWaysIntoParts(coords, name);
    try {
      parts.forEach((part, partIndex) => validatePart(part, `${name} (part ${partIndex + 1}/${parts.length})`));
    } catch (error) {
      console.warn(`  [warn] skipping alternate "${name}": ${(error as Error).message}`);
      continue;
    }
    candidates.push({ id: String(alt.id), name, parts: simplifyParts(parts) });
  }
  return candidates;
}

interface SharedBoundaryReportEntry {
  betweenOfficialNumbers: [number, number];
  distanceMeters: number;
}

interface ValidationReport {
  runAt: string;
  parameters: { boundaryThresholdMeters: number; sharedBoundaryToleranceMeters: number; simplifyToleranceDegrees: number };
  trustGpxSeason: string;
  totalSections: number;
  mainCount: number;
  bypassCount: number;
  producedCount: number;
  sections: SectionGeometryResult[];
  sharedBoundaryInconsistencies: SharedBoundaryReportEntry[];
  intervalOverlaps: { officialNumber: number; overlapsWith: number[] }[];
  wholeTrailMainLengthKm: number | null;
  regionFailures: RegionFailure[];
}

async function main() {
  const boundaryThresholdMeters = DEFAULT_BOUNDARY_THRESHOLD_METERS;
  const sharedBoundaryToleranceMeters = DEFAULT_SHARED_BOUNDARY_TOLERANCE_METERS;

  // --- 1. Trust GPX boundaries (in-memory only, never stored) ---
  console.log('Fetching Trust Section Routes GPX (boundary reference only, not stored)...');
  const routesDir = await fetchAndExtractTrustZip({ zipUrl: TRUST_ZIP_URL, scratchDir: TRUST_SCRATCH_DIR });
  const trustBoundaries = extractSectionBoundaries(routesDir);
  const expectedNumbers = new Set(SECTION_SEEDS.map((s) => s.officialNumber));
  for (const num of expectedNumbers) {
    if (!trustBoundaries.has(num)) throw new Error(`No Trust GPX file found for official_number ${num}`);
  }
  for (const num of trustBoundaries.keys()) {
    if (!expectedNumbers.has(num)) throw new Error(`Trust GPX file for official_number ${num} has no matching Phase 1 section row`);
  }
  console.log(`Matched all ${expectedNumbers.size} Trust GPX files to Phase 1 section rows.`);

  // --- 2/3. Raw OSM -> stitch/orient (per region) -> regional validation ---
  const { results: regionResults, failures: regionFailures } = await ingestAllRegions();
  const mainRouteRelationIds = new Set(regionResults.map((r) => r.relationId));

  // --- 4. Whole-island assembly (chain-following orientation) ---
  const regionInputs: RegionInput[] = regionResults.map((r) => ({
    regionId: r.name,
    island: r.island,
    sequence: r.sequence,
    parts: r.parts,
  }));
  const niLine = assembleIslandLine(regionInputs, 'NI');
  const siLine = assembleIslandLine(regionInputs, 'SI');

  // --- 5. Simplify (applied to the assembled island's own parts) ---
  niLine.parts = simplifyParts(niLine.parts);
  siLine.parts = simplifyParts(siLine.parts);

  // --- Bypass candidates (independent of island assembly) ---
  const bypassCandidates = await ingestBypassCandidates(mainRouteRelationIds);

  // --- Region-failure -> canonical region propagation (Priority 3: prefer
  // deterministic Phase 1 metadata over re-deriving anything geometrically) ---
  for (const region of regionResults) {
    if (!OSM_REGION_TO_CANONICAL[region.relationId]) {
      throw new Error(`OSM relation ${region.relationId} ("${region.name}") has no entry in OSM_REGION_TO_CANONICAL — update the mapping before trusting this run's region-failure propagation.`);
    }
  }
  for (const failure of regionFailures) {
    if (!OSM_REGION_TO_CANONICAL[failure.relationId]) {
      throw new Error(`Failed OSM relation ${failure.relationId} ("${failure.name}") has no entry in OSM_REGION_TO_CANONICAL — update the mapping before trusting this run's region-failure propagation.`);
    }
  }
  const failedCanonicalRegionIds = new Set(regionFailures.flatMap((f) => OSM_REGION_TO_CANONICAL[f.relationId]));
  function sectionRegionIds(sectionId: string): string[] {
    return SECTION_REGION_SEEDS.filter((r) => r.sectionId === sectionId).map((r) => r.regionId);
  }

  // --- 6. Boundary matching + 7. slicing + 8. dedupe + 9. final validation + 10. length ---
  const mainSections = SECTION_SEEDS.filter((s) => s.kind === 'main').sort((a, b) => a.officialNumber - b.officialNumber);
  const bypassSections = SECTION_SEEDS.filter((s) => s.kind === 'bypass');

  const sectionResults: SectionGeometryResult[] = [];
  const sharedBoundaryInconsistencies: SharedBoundaryReportEntry[] = [];
  const intervalOverlapsAll: { officialNumber: number; overlapsWith: number[] }[] = [];

  const attemptableMainSections: typeof mainSections = [];
  for (const section of mainSections) {
    // Priority 7 + Priority 3, via the pure, independently-tested classifier
    // in sectionPreflight.ts (ferry/water-taxi -> expected absence, not a
    // failed match; a section whose own region already failed OSM validation
    // is marked immediately rather than attempted against excluded data).
    const preflight = classifyMainSectionPreflight(section.travelMode, sectionRegionIds(section.id), failedCanonicalRegionIds);
    if (!preflight.attempt) {
      sectionResults.push({
        officialNumber: section.officialNumber,
        kind: 'main',
        produced: false,
        disposition: preflight.disposition,
        errors: preflight.errors,
      });
      continue;
    }
    attemptableMainSections.push(section);
  }

  for (const island of ['NI', 'SI'] as const) {
    const line = island === 'NI' ? niLine : siLine;

    const sectionsOnIsland = attemptableMainSections
      .filter((s) => {
        // Priority 2: deterministic Phase 1 metadata first — never a
        // latitude/longitude heuristic. Only falls back to trying both
        // island assemblies when metadata genuinely can't decide, and even
        // then only accepts an island when exactly one side is confidently
        // within threshold (never guesses).
        const metadataIsland = determineIslandFromMetadata(s.id);
        if (metadataIsland) return metadataIsland === island;
        return false; // handled once, below, not per-island
      })
      .sort((a, b) => a.officialNumber - b.officialNumber);

    const mainInputs: MainSectionInput[] = sectionsOnIsland.map((s) => {
      const b = trustBoundaries.get(s.officialNumber)!;
      return { officialNumber: s.officialNumber, trustStart: b.start, trustEnd: b.end };
    });
    const resolved = resolveMainSectionBoundaries(line, mainInputs, {
      thresholdMeters: boundaryThresholdMeters,
      sharedBoundaryToleranceMeters,
      // The FULL 81-section catalog, not attemptableMainSections — this is
      // what lets true-adjacency detection see past sections excluded this
      // run (source_region_failed, ferry/water-taxi) to the real numbering.
      allMainOfficialNumbers: mainSections.map((s) => s.officialNumber),
    });
    sharedBoundaryInconsistencies.push(...resolved.sharedBoundaryFlags);

    const resolvedIntervals: ResolvedInterval[] = [];
    const producedForOverlapCheck = new Map<
      number,
      { geometry: SectionGeometryResult['geometry']; lengthKm: number; matchedRegionIds: string[] }
    >();

    for (const section of sectionsOnIsland) {
      const start = resolved.startCuts.get(section.officialNumber)!;
      const end = resolved.endCuts.get(section.officialNumber)!;
      if (!start.cut || !end.cut) {
        sectionResults.push({
          officialNumber: section.officialNumber,
          kind: 'main',
          produced: false,
          disposition: 'no_candidate_within_threshold',
          errors: [
            !start.cut ? 'start boundary: no candidate within threshold' : '',
            !end.cut ? 'end boundary: no candidate within threshold' : '',
          ].filter(Boolean),
        });
        continue;
      }
      const sliced = sliceBetweenCuts(line.parts, start.cut, end.cut);
      if (!sliced.ok) {
        sectionResults.push({
          officialNumber: section.officialNumber,
          kind: 'main',
          produced: false,
          disposition: sliced.error.startsWith('order_violation') ? 'order_violation' : 'degenerate_slice',
          errors: [sliced.error],
        });
        continue;
      }
      const deduped = dedupeGeometry(sliced.geometry);
      const lengthKm = computeLengthKm(deduped);
      const matchedRegionIds = [...new Set([start.report.regionId, end.report.regionId].filter((r): r is string => !!r))];
      producedForOverlapCheck.set(section.officialNumber, { geometry: deduped, lengthKm, matchedRegionIds });
      resolvedIntervals.push({
        officialNumber: section.officialNumber,
        fromKm: Math.min(start.report.distanceAlongIslandKm ?? 0, end.report.distanceAlongIslandKm ?? 0),
        toKm: Math.max(start.report.distanceAlongIslandKm ?? 0, end.report.distanceAlongIslandKm ?? 0),
      });
    }

    // Priority 4 (interval-consistency safeguard): a technically-valid slice
    // that lands inside another, non-adjacent section's own territory is a
    // self-proximity signature independent of the length check — flag it
    // rather than accept it just because it looked fine in isolation.
    const overlaps = findIntervalOverlaps(resolvedIntervals);
    intervalOverlapsAll.push(...overlaps);
    const overlapNumbers = new Set(overlaps.map((o) => o.officialNumber));

    for (const [officialNumber, { geometry, lengthKm, matchedRegionIds }] of producedForOverlapCheck) {
      const section = sectionsOnIsland.find((s) => s.officialNumber === officialNumber)!;
      const errors: string[] = [];

      if (overlapNumbers.has(officialNumber)) {
        const overlap = overlaps.find((o) => o.officialNumber === officialNumber)!;
        sectionResults.push({
          officialNumber,
          kind: 'main',
          produced: false,
          // Candidate geometry retained for manual review only — produced:false
          // means it is never written to the shippable sections asset (see the
          // asset-writing filter below, which checks produced && geometry).
          geometry,
          matchedRegionIds,
          disposition: 'ambiguous_candidate',
          lengthKm,
          errors: [`resolved interval overlaps non-adjacent section(s): ${overlap.overlapsWith.join(', ')} — likely a self-proximate wrong-branch match`],
        });
        continue;
      }

      const lengthResult = checkLengthConfidence(lengthKm, section.officialDistanceKm);
      if (lengthResult.confidence === 'reject') {
        sectionResults.push({
          officialNumber,
          kind: 'main',
          produced: false,
          geometry, // review-only candidate geometry, not shipped — see note above
          matchedRegionIds,
          disposition: 'rejected_length_anomaly',
          lengthKm,
          errors: [`computed ${lengthKm.toFixed(2)}km vs official ${section.officialDistanceKm}km (${((lengthResult.diffPct ?? 0) * 100).toFixed(0)}% diff) — exceeds fail tolerance, not trusted as real geometry`],
        });
        continue;
      }
      if (lengthResult.confidence === 'low_confidence') {
        errors.push(`length warn: computed ${lengthKm.toFixed(2)}km vs official ${section.officialDistanceKm}km (${((lengthResult.diffPct ?? 0) * 100).toFixed(0)}% diff)`);
      }
      sectionResults.push({
        officialNumber,
        kind: 'main',
        produced: true,
        geometry,
        matchedRegionIds,
        lengthKm,
        disposition: lengthResult.confidence === 'low_confidence' ? 'matched_low_confidence' : 'matched',
        errors,
      });
    }
  }

  // Sections whose metadata alone couldn't determine an island (none
  // expected among the current 94, but handled rather than assumed away).
  for (const section of attemptableMainSections) {
    if (determineIslandFromMetadata(section.id)) continue;
    const b = trustBoundaries.get(section.officialNumber)!;
    const resolution = resolveAmbiguousIsland(b.start, niLine, siLine, boundaryThresholdMeters);
    sectionResults.push({
      officialNumber: section.officialNumber,
      kind: 'main',
      produced: false,
      disposition: 'island_ambiguous',
      errors: [
        `no island metadata; geometric fallback: NI dist=${resolution.niDistanceMeters?.toFixed(0) ?? 'n/a'}m, SI dist=${resolution.siDistanceMeters?.toFixed(0) ?? 'n/a'}m, resolved=${resolution.island ?? 'ambiguous'}`,
      ],
    });
  }

  for (const section of bypassSections) {
    const boundary = trustBoundaries.get(section.officialNumber);
    if (!boundary) {
      sectionResults.push({ officialNumber: section.officialNumber, kind: 'bypass', produced: false, disposition: 'no_candidates_available', errors: ['no Trust GPX boundary found'] });
      continue;
    }
    const input: BypassSectionInput = { officialNumber: section.officialNumber, trustStart: boundary.start, trustEnd: boundary.end };
    const match = matchBypassSection(input, bypassCandidates, boundaryThresholdMeters);
    if (!match.startCut || !match.endCut || !match.matchedCandidateId) {
      sectionResults.push({
        officialNumber: section.officialNumber,
        kind: 'bypass',
        produced: false,
        disposition: bypassCandidates.length === 0 ? 'no_candidates_available' : 'no_candidate_cleared_threshold',
        errors: ['no OSM alternate-relation candidate cleared the threshold for both boundaries (including a reversed-orientation retry)'],
      });
      continue;
    }
    const candidate = bypassCandidates.find((c) => c.id === match.matchedCandidateId)!;
    const sliced = sliceBetweenCuts(candidate.parts, match.startCut, match.endCut);
    if (!sliced.ok) {
      sectionResults.push({
        officialNumber: section.officialNumber,
        kind: 'bypass',
        produced: false,
        disposition: 'degenerate_slice',
        matchedCandidateId: match.matchedCandidateId,
        errors: [sliced.error],
      });
      continue;
    }
    const deduped = dedupeGeometry(sliced.geometry);
    const lengthKm = computeLengthKm(deduped);
    const lengthResult = checkLengthConfidence(lengthKm, section.officialDistanceKm);
    if (lengthResult.confidence === 'reject') {
      sectionResults.push({
        officialNumber: section.officialNumber,
        kind: 'bypass',
        produced: false,
        geometry: deduped, // review-only candidate geometry, not shipped
        disposition: 'rejected_length_anomaly',
        lengthKm,
        matchedCandidateId: match.matchedCandidateId,
        errors: [`computed ${lengthKm.toFixed(2)}km vs official ${section.officialDistanceKm}km (${((lengthResult.diffPct ?? 0) * 100).toFixed(0)}% diff) — exceeds fail tolerance, not trusted as real geometry`],
      });
      continue;
    }
    const errors: string[] = [];
    if (lengthResult.confidence === 'low_confidence') {
      errors.push(`length warn: computed ${lengthKm.toFixed(2)}km vs official ${section.officialDistanceKm}km (${((lengthResult.diffPct ?? 0) * 100).toFixed(0)}% diff)`);
    }
    sectionResults.push({
      officialNumber: section.officialNumber,
      kind: 'bypass',
      produced: true,
      geometry: deduped,
      lengthKm,
      disposition: lengthResult.confidence === 'low_confidence' ? 'matched_low_confidence' : 'matched',
      matchedCandidateId: match.matchedCandidateId,
      errors,
    });
  }

  // --- Whole-trail convenience geometry (Option A): concatenate produced
  // main, distance-counting sections in official_number order. Cook Strait
  // is preserved as a structural exception (the two connector sections
  // simply produce no geometry here, per policy — see below), never a
  // fabricated join. ---
  const mainProducedInOrder = sectionResults
    .filter((r) => r.kind === 'main' && r.produced && r.geometry)
    .sort((a, b) => a.officialNumber - b.officialNumber);
  const wholeTrailParts: Part[] = [];
  for (const r of mainProducedInOrder) {
    const section = SECTION_SEEDS.find((s) => s.officialNumber === r.officialNumber)!;
    if (!section.countsTowardTrailDistance) continue; // ferry/water-taxi legs
    if (r.geometry!.type === 'LineString') wholeTrailParts.push(r.geometry!.coordinates);
    else wholeTrailParts.push(...r.geometry!.coordinates);
  }
  const wholeTrailGeometry =
    wholeTrailParts.length > 0
      ? wholeTrailParts.length === 1
        ? { type: 'LineString' as const, coordinates: wholeTrailParts[0] }
        : { type: 'MultiLineString' as const, coordinates: wholeTrailParts }
      : null;
  const wholeTrailMainLengthKm = wholeTrailGeometry ? computeLengthKm(wholeTrailGeometry) : null;

  // --- Write OSM-only assets (never Trust coordinates) ---
  mkdirSync(ASSETS_DIR, { recursive: true });
  const sectionGeometryAssets = sectionResults
    .filter((r) => r.produced && r.geometry)
    .map((r) => ({
      officialNumber: r.officialNumber,
      kind: r.kind,
      geometry: r.geometry,
      sourceId: OSM_SOURCE_ID,
      importedAt: IMPORTED_AT,
    }));
  writeFileSync(join(ASSETS_DIR, 'te-araroa-sections.json'), JSON.stringify(sectionGeometryAssets));
  writeFileSync(
    join(ASSETS_DIR, 'te-araroa-whole-trail.json'),
    JSON.stringify(
      wholeTrailGeometry ? { geometry: wholeTrailGeometry, sourceId: OSM_SOURCE_ID, importedAt: IMPORTED_AT } : null,
    ),
  );

  // --- Write validation report (never Trust coordinates — see BoundaryMatchResult) ---
  mkdirSync(REPORT_DIR, { recursive: true });
  const report: ValidationReport = {
    runAt: new Date().toISOString(),
    parameters: {
      boundaryThresholdMeters,
      sharedBoundaryToleranceMeters,
      simplifyToleranceDegrees: SIMPLIFY_TOLERANCE_DEGREES,
    },
    trustGpxSeason: '2026-27',
    totalSections: SECTION_SEEDS.length,
    mainCount: mainSections.length,
    bypassCount: bypassSections.length,
    producedCount: sectionResults.filter((r) => r.produced).length,
    sections: sectionResults,
    sharedBoundaryInconsistencies,
    intervalOverlaps: intervalOverlapsAll,
    wholeTrailMainLengthKm,
    regionFailures,
  };
  const reportPath = join(REPORT_DIR, `ingest-report-${Date.now()}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 1));

  console.log(`\nDone. ${report.producedCount}/${report.totalSections} sections produced geometry.`);
  console.log(`Whole-trail main length: ${wholeTrailMainLengthKm?.toFixed(1) ?? 'n/a'}km`);
  console.log(`Report written to ${reportPath}`);
  console.log(`Assets written to ${ASSETS_DIR}`);

  if (regionFailures.length > 0) {
    console.error(
      `\n${regionFailures.length} region(s) failed OSM validation — this run's result is INCOMPLETE and must not be treated as trustworthy until investigated. See regionFailures in the report.`,
    );
    process.exitCode = 1;
  }
}

// Only run the full ingest when this file is the CLI entry point — other
// scripts (e.g. diagnose-boundary-match.ts) import its helper functions
// without wanting to trigger a full live Overpass run as a side effect.
const isMainModule = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((error) => {
    console.error('\nIngestion failed:', error.message);
    process.exit(1);
  });
}
