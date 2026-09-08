/**
 * Phase 2.5 diagnostic (read-only): traces the exact OSM way sequence
 * between two already-matched boundary coordinates within one region, to
 * distinguish (a) genuine loop/backtrack geometry, (b) OSM way
 * stitching/ordering artifacts, and (c) parallel/alternate branches being
 * collapsed into one assembled part.
 *
 * Does not call or modify stitchWaysIntoParts / resolveMainSectionBoundaries
 * / assembleIslandLine — it independently mirrors the same region-level
 * stitching logic (same thresholds: 300m split, 15m warn — copied, not
 * imported, since the originals are unexported constants) but additionally
 * records which way ID (and orientation) contributed each vertex, which the
 * production stitcher has no need to keep. This is read-only inspection of
 * cached Overpass data; it changes no production code or behavior.
 *
 * Input coordinates are the already-matched OSM boundary points from the
 * Phase 2.4 diagnostic output (scripts/.out/diagnostic-11.geojson /
 * diagnostic-59.geojson) — never raw Trust GPX coordinates.
 *
 * Run with: npx tsx scripts/diagnose-way-level-trace.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  fetchRelations,
  fetchWaysGeometry,
  overpassQuery,
  haversineMeters,
  __dirname as INGEST_DIRNAME,
  type OverpassRelation,
  type OverpassWay,
} from './ingest-te-araroa';
import { findNearestOnParts } from './lib/boundaryMatching';
import type { Coord, Part } from './lib/types';

const OUT_DIR = join(INGEST_DIRNAME, '.out');
const NORTH_ISLAND_RELATION_ID = 8518624;
// Mirrors the unexported constants in ingest-te-araroa.ts's stitchWaysIntoParts exactly.
const STITCH_GAP_WARN_METERS = 15;
const STITCH_SPLIT_THRESHOLD_METERS = 300;

interface WayProvenance {
  wayId: number;
  reversed: boolean;
  parentRelationId: number;
  parentRelationName: string;
  memberIndex: number;
}

async function loadRegion(namePattern: RegExp) {
  const island = await fetchRelations([NORTH_ISLAND_RELATION_ID]);
  const niRel = island.get(NORTH_ISLAND_RELATION_ID)!;
  const regionMemberIds = niRel.members.filter((m) => m.type === 'relation').map((m) => m.ref);
  const regionRels = await fetchRelations(regionMemberIds);
  const regionEntry = [...regionRels.values()].find((r) => namePattern.test(r.tags?.name ?? ''));
  if (!regionEntry) throw new Error(`No region matching ${namePattern}`);

  // Recursively resolve the full relation subtree (region -> lettered sub-relations -> ways),
  // tracking (parentRelationId, parentRelationName, memberIndex) per way for "relation/member
  // ordering" evidence, mirroring resolveToWayIds's own DFS order exactly.
  const allRelations = new Map<number, OverpassRelation>(regionRels);
  let frontier = [regionEntry];
  while (frontier.length > 0) {
    const nextIds = new Set<number>();
    for (const rel of frontier) for (const m of rel.members) if (m.type === 'relation' && !allRelations.has(m.ref)) nextIds.add(m.ref);
    if (nextIds.size === 0) break;
    const fetched = await fetchRelations([...nextIds]);
    for (const [id, rel] of fetched) allRelations.set(id, rel);
    frontier = [...fetched.values()];
  }

  const wayOrder: WayProvenance[] = [];
  function walk(relationId: number, depth = 0) {
    if (depth > 6) throw new Error(`Relation ${relationId} nests too deep`);
    const rel = allRelations.get(relationId)!;
    rel.members.forEach((m, idx) => {
      if (m.type === 'way') {
        wayOrder.push({ wayId: m.ref, reversed: false, parentRelationId: relationId, parentRelationName: rel.tags?.name ?? String(relationId), memberIndex: idx });
      } else if (m.type === 'relation') {
        walk(m.ref, depth + 1);
      }
    });
  }
  walk(regionEntry.id);

  const wayGeom = await fetchWaysGeometry(wayOrder.map((w) => w.wayId));

  // Fetch tags separately (fetchWaysGeometry only returns geometry).
  const tagsById = new Map<number, Record<string, string>>();
  const idsNeeded = wayOrder.map((w) => w.wayId);
  for (let i = 0; i < idsNeeded.length; i += 100) {
    const batch = idsNeeded.slice(i, i + 100);
    const key = `way-tags-${batch[0]}-${batch.length}`;
    const data = await overpassQuery<{ elements: (OverpassWay & { tags?: Record<string, string> })[] }>(
      `[out:json][timeout:180];way(id:${batch.join(',')});out tags;`,
      key,
    );
    for (const el of data.elements) if (el.tags) tagsById.set(el.id, el.tags);
  }

  return { regionEntry, wayOrder, wayGeom, tagsById };
}

/** Mirrors stitchWaysIntoParts exactly (same thresholds, same reversal rule) but also returns per-vertex way provenance. */
function stitchWithProvenance(
  wayOrder: WayProvenance[],
  wayGeom: Map<number, Part>,
): { parts: Part[]; provenance: WayProvenance[][] } {
  const usable = wayOrder.filter((w) => wayGeom.has(w.wayId));
  if (usable.length === 0) return { parts: [], provenance: [] };

  const parts: Part[] = [];
  const provenance: WayProvenance[][] = [];

  const first = usable[0];
  parts.push([...wayGeom.get(first.wayId)!]);
  provenance.push(wayGeom.get(first.wayId)!.map(() => ({ ...first })));

  for (let i = 1; i < usable.length; i++) {
    const w = usable[i];
    const coords = wayGeom.get(w.wayId)!;
    const currentPart = parts[parts.length - 1];
    const currentProv = provenance[provenance.length - 1];
    const partEnd = currentPart[currentPart.length - 1];
    const distToStart = haversineMeters(partEnd, coords[0]);
    const distToEnd = haversineMeters(partEnd, coords[coords.length - 1]);
    const gap = Math.min(distToStart, distToEnd);
    const reversed = distToStart > distToEnd;
    const oriented = reversed ? [...coords].reverse() : coords;

    if (gap > STITCH_SPLIT_THRESHOLD_METERS) {
      parts.push([...oriented]);
      provenance.push(oriented.map(() => ({ ...w, reversed })));
    } else {
      currentPart.push(...oriented.slice(1));
      currentProv.push(...oriented.slice(1).map(() => ({ ...w, reversed })));
    }
  }
  return { parts, provenance };
}

interface VertexMatch {
  partIndex: number;
  vertexIndex: number;
  distanceMeters: number;
}

/**
 * Locates a matched OSM coordinate against the (unsimplified) region-level
 * stitched parts using the same segment-projection primitive production
 * matching uses (findNearestOnParts, unmodified) — not a raw vertex scan.
 * The matched coordinate may be an interpolated point along a long way
 * segment, not an exact vertex, so segmentIndex (the vertex-pair it
 * projects onto) is the correct, robust way to locate it.
 */
function locate(parts: Part[], target: Coord): VertexMatch | null {
  const result = findNearestOnParts(parts, target);
  if (!result) return null;
  return { partIndex: result.cut.partIndex, vertexIndex: result.cut.segmentIndex, distanceMeters: result.distanceMeters };
}

interface Transition {
  vertexIndex: number;
  cumulativeDistanceFromSpanStartKm: number;
  previousWayId: number;
  previousWayName: string | null;
  nextWayId: number;
  nextWayName: string | null;
  endpointGapMeters: number;
  sharesEndpointCleanly: boolean;
  nextWayReversed: boolean;
  parentRelation: string;
}

interface BacktrackPoint {
  vertexIndex: number;
  cumulativeDistanceFromSpanStartKm: number;
  nearestEarlierVertexIndex: number;
  nearestEarlierDistanceMeters: number;
  vertexIndexGap: number;
}

function traceSpan(
  parts: Part[],
  provenance: WayProvenance[][],
  tagsById: Map<number, Record<string, string>>,
  partIndex: number,
  vA: number,
  vB: number,
) {
  const part = parts[partIndex];
  const prov = provenance[partIndex];
  const lo = Math.min(vA, vB);
  const hi = Math.max(vA, vB);

  let cum = 0;
  const cumAtVertex: number[] = [0];
  for (let i = lo + 1; i <= hi; i++) {
    cum += haversineMeters(part[i - 1], part[i]);
    cumAtVertex.push(cum);
  }

  const transitions: Transition[] = [];
  for (let i = lo + 1; i <= hi; i++) {
    if (prov[i].wayId !== prov[i - 1].wayId) {
      const prevCoords = part[i - 1];
      const nextCoords = part[i];
      const gap = haversineMeters(prevCoords, nextCoords);
      transitions.push({
        vertexIndex: i,
        cumulativeDistanceFromSpanStartKm: +(cumAtVertex[i - lo] / 1000).toFixed(3),
        previousWayId: prov[i - 1].wayId,
        previousWayName: tagsById.get(prov[i - 1].wayId)?.name ?? null,
        nextWayId: prov[i].wayId,
        nextWayName: tagsById.get(prov[i].wayId)?.name ?? null,
        endpointGapMeters: +gap.toFixed(2),
        sharesEndpointCleanly: gap <= STITCH_GAP_WARN_METERS,
        nextWayReversed: prov[i].reversed,
        parentRelation: prov[i].parentRelationName,
      });
    }
  }

  // Backtrack detection: for each vertex in the span, find the nearest EARLIER
  // vertex (anywhere earlier in the whole part, not just the span) that sits far
  // away in vertex-index terms (>=20 vertices back) but close in space (<=60m).
  // This is the concrete signature of "the path moved back toward an earlier
  // geographic location" — a real spatial loop, independent of way boundaries.
  const backtracks: BacktrackPoint[] = [];
  for (let i = lo; i <= hi; i++) {
    let best: { j: number; d: number } | null = null;
    for (let j = 0; j < i - 20; j++) {
      const d = haversineMeters(part[i], part[j]);
      if (d <= 60 && (!best || d < best.d)) best = { j, d };
    }
    if (best) {
      backtracks.push({
        vertexIndex: i,
        cumulativeDistanceFromSpanStartKm: i >= lo ? +(cumAtVertex[i - lo] / 1000).toFixed(3) : 0,
        nearestEarlierVertexIndex: best.j,
        nearestEarlierDistanceMeters: +best.d.toFixed(2),
        vertexIndexGap: i - best.j,
      });
    }
  }

  const waysInSpan = [...new Set(prov.slice(lo, hi + 1).map((p) => p.wayId))].map((id) => ({
    wayId: id,
    name: tagsById.get(id)?.name ?? null,
    highway: tagsById.get(id)?.highway ?? null,
    parentRelation: prov.find((p) => p.wayId === id)?.parentRelationName ?? null,
  }));

  return {
    spanVertexRange: [lo, hi] as [number, number],
    spanLengthKm: +(cum / 1000).toFixed(3),
    wayCount: waysInSpan.length,
    waysInSpan,
    transitions,
    backtracks: backtracks.sort((a, b) => a.nearestEarlierDistanceMeters - b.nearestEarlierDistanceMeters).slice(0, 10),
  };
}

function loadDiagnosticCoord(file: string, officialNumber: number, boundaryRole: 'start' | 'end'): Coord {
  const gj = JSON.parse(readFileSync(join(OUT_DIR, file), 'utf-8'));
  const f = gj.features.find(
    (x: any) => x.properties.candidateType === 'matched-boundary-point' && x.properties.officialNumber === officialNumber && x.properties.boundaryRole === boundaryRole,
  );
  if (!f) throw new Error(`Coordinate not found: ${file} #${officialNumber} ${boundaryRole}`);
  return f.geometry.coordinates as Coord;
}

async function investigateSection(regionPattern: RegExp, label: string, points: { name: string; coord: Coord }[]) {
  const { wayOrder, wayGeom, tagsById } = await loadRegion(regionPattern);
  const { parts, provenance } = stitchWithProvenance(wayOrder, wayGeom);

  const located = points.map((p) => ({ ...p, match: locate(parts, p.coord) }));

  console.log(`\n=== ${label} — vertex location ===`);
  for (const p of located) {
    if (!p.match) {
      console.log(`${p.name}: NOT FOUND on region-level stitched parts`);
      continue;
    }
    const wayId = provenance[p.match.partIndex][p.match.vertexIndex]?.wayId;
    console.log(`${p.name}: part ${p.match.partIndex} vertex ${p.match.vertexIndex}, ${p.match.distanceMeters.toFixed(2)}m from simplified match, way ${wayId}`);
  }
  return { parts, provenance, tagsById, located };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  // --- #11 ---
  const s11Start = loadDiagnosticCoord('diagnostic-11.geojson', 11, 'start');
  const s11End = loadDiagnosticCoord('diagnostic-11.geojson', 11, 'end');
  const ctx11 = await investigateSection(/01 Northland/, '#11 Northland', [
    { name: '#11 start (=#9 end)', coord: s11Start },
    { name: '#11 end (=#12 start)', coord: s11End },
  ]);
  const start11 = ctx11.located[0].match;
  const end11 = ctx11.located[1].match;
  let trace11: unknown = null;
  if (start11 && end11 && start11.partIndex === end11.partIndex) {
    trace11 = traceSpan(ctx11.parts, ctx11.provenance, ctx11.tagsById, start11.partIndex, start11.vertexIndex, end11.vertexIndex);
  } else {
    trace11 = { error: 'start/end matched in different parts — cannot trace a single-part span', start11, end11 };
  }
  writeFileSync(join(OUT_DIR, 'way-trace-11.json'), JSON.stringify(trace11, null, 1));
  console.log('\n#11 trace summary:', JSON.stringify({ wayCount: (trace11 as any).wayCount, transitionCount: (trace11 as any).transitions?.length, backtrackCount: (trace11 as any).backtracks?.length }, null, 1));

  // --- #59 (with #58/#60 context) ---
  const s58Start = loadDiagnosticCoord('diagnostic-59.geojson', 58, 'start');
  const s58End = loadDiagnosticCoord('diagnostic-59.geojson', 58, 'end');
  const s59Start = loadDiagnosticCoord('diagnostic-59.geojson', 59, 'start');
  const s59End = loadDiagnosticCoord('diagnostic-59.geojson', 59, 'end');
  const s60Start = loadDiagnosticCoord('diagnostic-59.geojson', 60, 'start');
  const s60End = loadDiagnosticCoord('diagnostic-59.geojson', 60, 'end');
  const ctx59 = await investigateSection(/05 Wellington/, '#58/#59/#60 Wellington', [
    { name: '#58 start', coord: s58Start },
    { name: '#58 end (=#59 start)', coord: s58End },
    { name: '#59 end (=#60 start)', coord: s59End },
    { name: '#60 end', coord: s60End },
  ]);
  const m58s = ctx59.located[0].match;
  const m58e = ctx59.located[1].match;
  const m59e = ctx59.located[2].match;
  const m60e = ctx59.located[3].match;

  const spans: Record<string, unknown> = {};
  if (m58s && m58e && m58s.partIndex === m58e.partIndex) {
    spans['section58_startToEnd'] = traceSpan(ctx59.parts, ctx59.provenance, ctx59.tagsById, m58s.partIndex, m58s.vertexIndex, m58e.vertexIndex);
  }
  if (m58e && m59e && m58e.partIndex === m59e.partIndex) {
    spans['section59_startToEnd'] = traceSpan(ctx59.parts, ctx59.provenance, ctx59.tagsById, m58e.partIndex, m58e.vertexIndex, m59e.vertexIndex);
  }
  if (m59e && m60e && m59e.partIndex === m60e.partIndex) {
    spans['section60_startToEnd'] = traceSpan(ctx59.parts, ctx59.provenance, ctx59.tagsById, m59e.partIndex, m59e.vertexIndex, m60e.vertexIndex);
  }
  writeFileSync(join(OUT_DIR, 'way-trace-59.json'), JSON.stringify(spans, null, 1));
  for (const [k, v] of Object.entries(spans)) {
    console.log(`\n${k} summary:`, JSON.stringify({ wayCount: (v as any).wayCount, transitionCount: (v as any).transitions?.length, backtrackCount: (v as any).backtracks?.length, spanLengthKm: (v as any).spanLengthKm }, null, 1));
  }

  console.log('\nArtifacts written: way-trace-11.json, way-trace-59.json in', OUT_DIR);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
