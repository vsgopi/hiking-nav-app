/**
 * Diagnostic tool (not part of the ingest pipeline) for inspecting exactly
 * why a specific section's boundary match landed where it did. Reuses
 * cached Overpass + Trust GPX data (scripts/.cache, scripts/.cache-trust-boundaries)
 * so it makes no new network calls when that cache is already warm.
 *
 * Run with: npx tsx scripts/diagnose-boundary-match.ts <officialNumber> [officialNumber...]
 */
import { join } from 'node:path';
import { SECTION_SEEDS } from '../src/core/database/seedData/officialSections2026_27';
import { assembleIslandLine, type RegionInput } from './lib/islandAssembly';
import { resolveMainSectionBoundaries, type MainSectionInput } from './lib/boundaryMatching';
import {
  fetchRelations,
  fetchWaysGeometry,
  resolveToWayIds,
  stitchWaysIntoParts,
  validatePart,
  __dirname as INGEST_DIRNAME,
} from './ingest-te-araroa';
import { extractSectionBoundaries } from './lib/trustBoundaries';
import { haversineMeters } from './lib/geoMath';
import { determineIslandFromMetadata } from './lib/islandSelection';

const NORTH_ISLAND_RELATION_ID = 8518624;
const SOUTH_ISLAND_RELATION_ID = 8518626;
const TRUST_ROUTES_DIR = join(INGEST_DIRNAME, '.cache-trust-boundaries', 'extracted', 'Routes');

async function main() {
  const targetNumbers = process.argv.slice(2).map(Number);
  if (targetNumbers.length === 0) {
    console.error('Usage: npx tsx scripts/diagnose-boundary-match.ts <officialNumber> [...]');
    process.exit(1);
  }

  const trustBoundaries = extractSectionBoundaries(TRUST_ROUTES_DIR);

  const islands = await fetchRelations([NORTH_ISLAND_RELATION_ID, SOUTH_ISLAND_RELATION_ID]);
  const regionOrder: { id: number; island: 'NI' | 'SI'; sequence: number }[] = [];
  for (const [islandId, code] of [
    [NORTH_ISLAND_RELATION_ID, 'NI'] as const,
    [SOUTH_ISLAND_RELATION_ID, 'SI'] as const,
  ]) {
    const island = islands.get(islandId)!;
    let seq = 0;
    for (const member of island.members) {
      if (member.type === 'relation') regionOrder.push({ id: member.ref, island: code, sequence: ++seq });
    }
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
  const regionNames = new Map<number, string>();
  for (const region of regionOrder) {
    const rel = regionRelations.get(region.id)!;
    const name = rel.tags?.name ?? `region-${region.id}`;
    regionNames.set(region.id, name);
    const wayIds = regionWayIdLists.get(region.id) ?? [];
    const coords = wayIds.map((id) => wayGeometries.get(id)).filter((c): c is [number, number][] => !!c);
    let parts;
    try {
      parts = stitchWaysIntoParts(coords, name);
      parts.forEach((p, i) => validatePart(p, `${name} (${i})`));
    } catch (e) {
      console.log(`[skip region ${name}: ${(e as Error).message}]`);
      continue;
    }
    regionInputs.push({ regionId: name, island: region.island, sequence: region.sequence, parts });
  }

  const niLine = assembleIslandLine(regionInputs, 'NI');
  const siLine = assembleIslandLine(regionInputs, 'SI');

  const mainSections = SECTION_SEEDS.filter((s) => s.kind === 'main').sort((a, b) => a.officialNumber - b.officialNumber);

  for (const island of ['NI', 'SI'] as const) {
    const line = island === 'NI' ? niLine : siLine;
    const sectionsOnIsland = mainSections.filter((s) => determineIslandFromMetadata(s.id) === island);
    const inputs: MainSectionInput[] = sectionsOnIsland.map((s) => {
      const b = trustBoundaries.get(s.officialNumber)!;
      return { officialNumber: s.officialNumber, trustStart: b.start, trustEnd: b.end };
    });
    const resolved = resolveMainSectionBoundaries(line, inputs, {
      thresholdMeters: 200,
      sharedBoundaryToleranceMeters: 5,
      allMainOfficialNumbers: mainSections.map((s) => s.officialNumber),
    });

    for (const num of targetNumbers) {
      if (!sectionsOnIsland.some((s) => s.officialNumber === num)) continue;
      const section = SECTION_SEEDS.find((s) => s.officialNumber === num)!;
      const trust = trustBoundaries.get(num)!;
      const start = resolved.startCuts.get(num)!;
      const end = resolved.endCuts.get(num)!;

      console.log(`\n=== Section #${num}: ${section.officialName} (island ${island}) ===`);
      console.log(`Trust start: [${trust.start.join(', ')}]   Trust end: [${trust.end.join(', ')}]`);
      console.log(`Official distance: ${section.officialDistanceKm}km`);

      for (const [label, res] of [['start', start], ['end', end]] as const) {
        if (!res.cut) {
          console.log(`  ${label}: NOT MATCHED`);
          continue;
        }
        const part = line.parts[res.cut.partIndex];
        console.log(
          `  ${label}: matched [${res.cut.coordinate.join(', ')}]  dist=${res.report.distanceMeters?.toFixed(1)}m  ` +
            `part=${res.cut.partIndex}/${line.parts.length - 1}  segment=${res.cut.segmentIndex}/${part.length - 2}  ` +
            `alongIsland=${res.report.distanceAlongIslandKm?.toFixed(2)}km  region=${res.report.regionId}`,
        );
        // Show a window of the ORIGINAL part's own vertices around the matched segment.
        const windowStart = Math.max(0, res.cut.segmentIndex - 3);
        const windowEnd = Math.min(part.length, res.cut.segmentIndex + 5);
        console.log(`    context (part ${res.cut.partIndex}, vertices ${windowStart}..${windowEnd - 1}):`);
        for (let i = windowStart; i < windowEnd; i++) {
          const marker = i === res.cut.segmentIndex || i === res.cut.segmentIndex + 1 ? '  <-- adjacent to cut' : '';
          console.log(`      [${i}] [${part[i][0].toFixed(6)}, ${part[i][1].toFixed(6)}]${marker}`);
        }
      }

      // Distance from the OTHER boundary's Trust anchor to THIS boundary's
      // matched point, and vice versa — a huge value close to 0 relative to
      // the official distance would indicate the two matched points aren't
      // where they should be relative to each other.
      if (start.cut && end.cut) {
        const directTrustDistanceM = haversineMeters(trust.start, trust.end);
        const directMatchedDistanceM = haversineMeters(start.cut.coordinate, end.cut.coordinate);
        console.log(`  Trust start->end straight-line distance: ${(directTrustDistanceM / 1000).toFixed(2)}km`);
        console.log(`  Matched start->end straight-line distance: ${(directMatchedDistanceM / 1000).toFixed(2)}km`);
        console.log(
          `  Along-island span (end - start): ${((end.report.distanceAlongIslandKm ?? 0) - (start.report.distanceAlongIslandKm ?? 0)).toFixed(2)}km`,
        );
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
