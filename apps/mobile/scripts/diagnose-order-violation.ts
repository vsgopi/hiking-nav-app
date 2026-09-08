/**
 * Phase 2.4 diagnostic (read-only, not part of the ingest pipeline): for a
 * given main section, re-runs the EXISTING, unmodified matching/slicing
 * functions (resolveMainSectionBoundaries, sliceBetweenCuts) purely for
 * inspection, and emits a GeoJSON FeatureCollection showing:
 *  - each boundary's matched OSM coordinate (never the raw Trust anchor —
 *    see the project-wide rule in scripts/lib/trustBoundaries.ts; the
 *    matched OSM point stands in for it, and is within meters of it per
 *    every prior diagnosis in this investigation)
 *  - the candidate OSM path (the full relevant part(s) of the island line)
 *  - the same for immediate neighboring sections, for visual comparison
 *
 * No raw Trust GPX coordinates are written to disk anywhere by this script.
 * Does not change resolveMainSectionBoundaries, sliceBetweenCuts, or any
 * other matching/slicing code — only calls them and records what comes back.
 *
 * Run with: npx tsx scripts/diagnose-order-violation.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { SECTION_SEEDS } from '../src/core/database/seedData/officialSections2026_27';
import { assembleIslandLine, type RegionInput } from './lib/islandAssembly';
import {
  matchBypassSection,
  resolveMainSectionBoundaries,
  type BypassSectionInput,
  type MainSectionInput,
} from './lib/boundaryMatching';
import { sliceBetweenCuts } from './lib/sectionSlicing';
import { extractSectionBoundaries, fetchAndExtractTrustZip } from './lib/trustBoundaries';
import { determineIslandFromMetadata } from './lib/islandSelection';
import {
  fetchRelations,
  fetchWaysGeometry,
  resolveToWayIds,
  stitchWaysIntoParts,
  simplifyParts,
  validatePart,
  __dirname as INGEST_DIRNAME,
} from './ingest-te-araroa';
import type { BypassCandidate, Coord, IslandLine, Part } from './lib/types';

const OUT_DIR = join(INGEST_DIRNAME, '.out');
const TRUST_SCRATCH_DIR = join(INGEST_DIRNAME, '.cache-trust-boundaries');
const NORTH_ISLAND_RELATION_ID = 8518624;
const SOUTH_ISLAND_RELATION_ID = 8518626;
const THRESHOLD_METERS = 200;
const SHARED_TOLERANCE_METERS = 5;

interface GeoJsonFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: { type: 'Point'; coordinates: Coord } | { type: 'LineString'; coordinates: Coord[] } | { type: 'MultiLineString'; coordinates: Coord[][] } | null;
}

function pointFeature(coord: Coord, properties: Record<string, unknown>): GeoJsonFeature {
  return { type: 'Feature', properties, geometry: { type: 'Point', coordinates: coord } };
}

function pathFeature(parts: Part[], properties: Record<string, unknown>): GeoJsonFeature {
  return {
    type: 'Feature',
    properties,
    geometry: parts.length === 1 ? { type: 'LineString', coordinates: parts[0] } : { type: 'MultiLineString', coordinates: parts },
  };
}

async function buildContext() {
  const routesDir = await fetchAndExtractTrustZip({
    zipUrl: 'https://www.teararoa.org.nz/wp-content/uploads/2026/06/TeAraroaTrail_Section_Routes_2026_27_GPX.zip',
    scratchDir: TRUST_SCRATCH_DIR,
  });
  const trustBoundaries = extractSectionBoundaries(routesDir);

  const islands = await fetchRelations([NORTH_ISLAND_RELATION_ID, SOUTH_ISLAND_RELATION_ID]);
  const regionOrder: { id: number; island: 'NI' | 'SI'; sequence: number }[] = [];
  for (const [islandId, code] of [[NORTH_ISLAND_RELATION_ID, 'NI'] as const, [SOUTH_ISLAND_RELATION_ID, 'SI'] as const]) {
    const island = islands.get(islandId)!;
    let seq = 0;
    for (const m of island.members) if (m.type === 'relation') regionOrder.push({ id: m.ref, island: code, sequence: ++seq });
  }
  const regionRelations = await fetchRelations(regionOrder.map((r) => r.id));
  const allRelationsNeeded = new Map(regionRelations);
  let frontier = [...regionRelations.values()];
  while (frontier.length > 0) {
    const nextIds = new Set<number>();
    for (const rel of frontier) for (const m of rel.members) if (m.type === 'relation' && !allRelationsNeeded.has(m.ref)) nextIds.add(m.ref);
    if (nextIds.size === 0) break;
    const fetched = await fetchRelations([...nextIds]);
    for (const [id, rel] of fetched) allRelationsNeeded.set(id, rel);
    frontier = [...fetched.values()];
  }
  const regionWayIdLists = new Map<number, number[]>();
  for (const region of regionOrder) regionWayIdLists.set(region.id, await resolveToWayIds(region.id, allRelationsNeeded));
  const allWayIds = [...new Set([...regionWayIdLists.values()].flat())];
  const wayGeometries = await fetchWaysGeometry(allWayIds);

  const regionInputs: RegionInput[] = [];
  for (const region of regionOrder) {
    const rel = regionRelations.get(region.id)!;
    const name = rel.tags?.name ?? `region-${region.id}`;
    const wayIds = regionWayIdLists.get(region.id) ?? [];
    const coords = wayIds.map((id) => wayGeometries.get(id)).filter((c): c is Part => !!c);
    try {
      const parts = stitchWaysIntoParts(coords, name);
      parts.forEach((p, i) => validatePart(p, `${name} (${i})`));
      regionInputs.push({ regionId: name, island: region.island, sequence: region.sequence, parts });
    } catch (e) {
      console.log(`[skip region ${name}: ${(e as Error).message}]`);
    }
  }
  const niLine = assembleIslandLine(regionInputs, 'NI');
  const siLine = assembleIslandLine(regionInputs, 'SI');
  niLine.parts = simplifyParts(niLine.parts);
  siLine.parts = simplifyParts(siLine.parts);

  return { trustBoundaries, niLine, siLine };
}

function resolveForIsland(
  line: IslandLine,
  numbers: number[],
  trustBoundaries: Map<number, { start: Coord; end: Coord }>,
) {
  const inputs: MainSectionInput[] = numbers
    .sort((a, b) => a - b)
    .map((n) => {
      const b = trustBoundaries.get(n)!;
      return { officialNumber: n, trustStart: b.start, trustEnd: b.end };
    });
  return resolveMainSectionBoundaries(line, inputs, {
    thresholdMeters: THRESHOLD_METERS,
    sharedBoundaryToleranceMeters: SHARED_TOLERANCE_METERS,
    allMainOfficialNumbers: numbers,
  });
}

/** Investigates one target main section against a chosen set of "context" neighbor numbers (main sections resolved in the same chain call, for realistic shared-boundary behavior). */
async function investigate(
  targetNumber: number,
  contextMainNumbers: number[],
  bypassNumber: number | null,
  niLine: IslandLine,
  siLine: IslandLine,
  trustBoundaries: Map<number, { start: Coord; end: Coord }>,
) {
  const seed = SECTION_SEEDS.find((s) => s.officialNumber === targetNumber)!;
  const island = determineIslandFromMetadata(seed.id);
  const line = island === 'NI' ? niLine : siLine;

  const resolved = resolveForIsland(line, contextMainNumbers, trustBoundaries);
  const features: GeoJsonFeature[] = [];
  const report: Record<string, unknown> = { officialNumber: targetNumber, officialName: seed.officialName, officialDistanceKm: seed.officialDistanceKm };

  for (const n of contextMainNumbers) {
    const s = SECTION_SEEDS.find((x) => x.officialNumber === n)!;
    const start = resolved.startCuts.get(n)!;
    const end = resolved.endCuts.get(n)!;
    const role = n === targetNumber ? 'target' : 'neighbor';

    if (start.cut && start.report.matched) {
      features.push(
        pointFeature(start.cut.coordinate, {
          candidateType: 'matched-boundary-point',
          role,
          officialNumber: n,
          officialName: s.officialName,
          boundaryRole: 'start',
          distanceFromAnchorMeters: start.report.distanceMeters,
          distanceAlongIslandKm: start.report.distanceAlongIslandKm,
          matchedRegion: start.report.regionId,
          partIndex: start.cut.partIndex,
          segmentIndex: start.cut.segmentIndex,
        }),
      );
    }
    if (end.cut && end.report.matched) {
      features.push(
        pointFeature(end.cut.coordinate, {
          candidateType: 'matched-boundary-point',
          role,
          officialNumber: n,
          officialName: s.officialName,
          boundaryRole: 'end',
          distanceFromAnchorMeters: end.report.distanceMeters,
          distanceAlongIslandKm: end.report.distanceAlongIslandKm,
          matchedRegion: end.report.regionId,
          partIndex: end.cut.partIndex,
          segmentIndex: end.cut.segmentIndex,
        }),
      );
    }

    if (n === targetNumber) {
      report['startBoundary'] = start.cut
        ? {
            matched: true,
            distanceFromAnchorMeters: start.report.distanceMeters,
            distanceAlongIslandKm: start.report.distanceAlongIslandKm,
            region: start.report.regionId,
            partIndex: start.cut.partIndex,
            segmentIndex: start.cut.segmentIndex,
          }
        : { matched: false };
      report['endBoundary'] = end.cut
        ? {
            matched: true,
            distanceFromAnchorMeters: end.report.distanceMeters,
            distanceAlongIslandKm: end.report.distanceAlongIslandKm,
            region: end.report.regionId,
            partIndex: end.cut.partIndex,
            segmentIndex: end.cut.segmentIndex,
          }
        : { matched: false };

      if (start.cut && end.cut) {
        const sliced = sliceBetweenCuts(line.parts, start.cut, end.cut);
        report['sliceResult'] = sliced.ok ? { ok: true } : { ok: false, error: sliced.error };
        if (!sliced.ok) {
          const startAlong = start.report.distanceAlongIslandKm ?? 0;
          const endAlong = end.report.distanceAlongIslandKm ?? 0;
          report['alongIslandSpanKm'] = +(endAlong - startAlong).toFixed(3);
        }
      }
    }

    // Candidate path: the relevant OSM part(s) around this section's own cuts, for visual inspection.
    if (start.cut) {
      const partIndices = new Set([start.cut.partIndex, end.cut?.partIndex ?? start.cut.partIndex]);
      for (const pi of partIndices) {
        features.push(
          pathFeature([line.parts[pi]], {
            candidateType: 'candidate-path',
            role,
            officialNumber: n,
            officialName: s.officialName,
            partIndex: pi,
            pointCount: line.parts[pi].length,
            note: 'Full OSM part containing this section\'s matched boundary — for visual self-crossing inspection.',
          }),
        );
      }
    }
  }

  // Bypass context, if requested (e.g. #10 for #11).
  if (bypassNumber !== null) {
    const bSeed = SECTION_SEEDS.find((s) => s.officialNumber === bypassNumber)!;
    const b = trustBoundaries.get(bypassNumber)!;
    // Reuse the same candidate discovery the production bypass path uses —
    // read-only, no modification. For diagnostic purposes we only need
    // whether it matches the SAME OSM region as #11, not a full bypass
    // candidate search (that's already covered in the Phase 2.1-2.3 reports).
    report['bypassContext'] = {
      officialNumber: bypassNumber,
      officialName: bSeed.officialName,
      note: 'See prior review package for this bypass\'s own candidate match — not re-run here since it is a different candidate pool (OSM alternate relations, not the main island line).',
    };
  }

  return { report, collection: { type: 'FeatureCollection' as const, features } };
}

async function main() {
  const { trustBoundaries, niLine, siLine } = await buildContext();
  mkdirSync(OUT_DIR, { recursive: true });

  // #11: context chain 9 -> 11 -> 12 (9 provides 11's real start-sharing
  // neighbor; 10 is a bypass, handled separately, not part of the main chain).
  const r11 = await investigate(11, [9, 11, 12], 10, niLine, siLine, trustBoundaries);
  writeFileSync(join(OUT_DIR, 'diagnostic-11.geojson'), JSON.stringify(r11.collection, null, 1));
  writeFileSync(join(OUT_DIR, 'diagnostic-11-report.json'), JSON.stringify(r11.report, null, 1));
  console.log('#11 report:', JSON.stringify(r11.report, null, 1));

  // #59: context chain 57 -> 58 -> 59 -> 60 -> 61.
  const r59 = await investigate(59, [57, 58, 59, 60, 61], null, niLine, siLine, trustBoundaries);
  writeFileSync(join(OUT_DIR, 'diagnostic-59.geojson'), JSON.stringify(r59.collection, null, 1));
  writeFileSync(join(OUT_DIR, 'diagnostic-59-report.json'), JSON.stringify(r59.report, null, 1));
  console.log('#59 report:', JSON.stringify(r59.report, null, 1));

  console.log('\nArtifacts written to', OUT_DIR);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
