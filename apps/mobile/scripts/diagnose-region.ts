/**
 * Diagnostic tool (not part of the ingest pipeline): dumps the resolved way
 * list for one region relation, in order, with each way's endpoint and
 * length — for spotting duplicated way ids or out-of-sequence jumps. Reuses
 * cached Overpass data (scripts/.cache), no new network calls if warm.
 *
 * Run with: npx tsx scripts/diagnose-region.ts <relationId>
 */
import { fetchRelations, fetchWaysGeometry, resolveToWayIds, haversineMeters } from './ingest-te-araroa';

async function main() {
  const relationId = Number(process.argv[2]);
  if (!relationId) {
    console.error('Usage: npx tsx scripts/diagnose-region.ts <relationId>');
    process.exit(1);
  }

  const relations = await fetchRelations([relationId]);
  const root = relations.get(relationId)!;
  console.log(`Relation ${relationId}: "${root.tags?.name}" (distance tag: ${root.tags?.distance})`);
  console.log(`Direct members: ${root.members.length} (${root.members.filter((m) => m.type === 'way').length} ways, ${root.members.filter((m) => m.type === 'relation').length} sub-relations)`);

  const allRelationsNeeded = new Map(relations);
  let frontier = [...relations.values()];
  let depth = 0;
  while (frontier.length > 0) {
    depth++;
    const nextIds = new Set<number>();
    for (const rel of frontier) for (const m of rel.members) if (m.type === 'relation' && !allRelationsNeeded.has(m.ref)) nextIds.add(m.ref);
    if (nextIds.size === 0) break;
    console.log(`  tier ${depth}: resolving ${nextIds.size} sub-relation(s): ${[...nextIds].join(', ')}`);
    const fetched = await fetchRelations([...nextIds]);
    for (const [id, rel] of fetched) {
      allRelationsNeeded.set(id, rel);
      console.log(`    ${id} "${rel.tags?.name}": ${rel.members.length} members (${rel.members.filter((m) => m.type === 'way').length} ways)`);
    }
    frontier = [...fetched.values()];
  }

  const wayIds = await resolveToWayIds(relationId, allRelationsNeeded);
  console.log(`\nResolved to ${wayIds.length} way ids (${new Set(wayIds).size} distinct — ${wayIds.length - new Set(wayIds).size} duplicate reference(s))`);

  // Report duplicates explicitly.
  const seen = new Map<number, number[]>();
  wayIds.forEach((id, i) => seen.set(id, [...(seen.get(id) ?? []), i]));
  for (const [id, positions] of seen) {
    if (positions.length > 1) console.log(`  DUPLICATE way ${id} referenced at positions: ${positions.join(', ')}`);
  }

  const wayGeometries = await fetchWaysGeometry(wayIds);
  console.log('\nWay-by-way (in resolved order), with gap to previous way\'s end:');
  let prevEnd: [number, number] | null = null;
  wayIds.forEach((id, i) => {
    const coords = wayGeometries.get(id);
    if (!coords) {
      console.log(`  [${i}] way ${id}: NO GEOMETRY`);
      return;
    }
    const start = coords[0];
    const end = coords[coords.length - 1];
    let gapNote = '';
    if (prevEnd) {
      const gapM = haversineMeters(prevEnd, start);
      const gapMEnd = haversineMeters(prevEnd, end);
      const gap = Math.min(gapM, gapMEnd);
      if (gap > 250) gapNote = `  <<< ${(gap / 1000).toFixed(2)}km GAP from previous way's end`;
    }
    console.log(
      `  [${i}] way ${id}: ${coords.length}pts  start=[${start[0].toFixed(4)},${start[1].toFixed(4)}] end=[${end[0].toFixed(4)},${end[1].toFixed(4)}]${gapNote}`,
    );
    prevEnd = end;
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
