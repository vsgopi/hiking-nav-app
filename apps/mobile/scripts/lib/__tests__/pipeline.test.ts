import { assembleIslandLine, type RegionInput } from '../islandAssembly';
import { resolveMainSectionBoundaries, type MainSectionInput } from '../boundaryMatching';
import { dedupeGeometry, sliceBetweenCuts } from '../sectionSlicing';

const regions: RegionInput[] = [
  {
    regionId: 'r1',
    island: 'NI',
    sequence: 1,
    parts: [
      [
        [172.7, -34.5],
        [172.75, -34.6],
        [172.8, -34.7],
        [172.85, -34.8],
      ],
    ],
  },
  {
    regionId: 'r2',
    island: 'NI',
    sequence: 2,
    parts: [
      [
        [172.9, -34.9],
        [172.95, -35.0],
        [173.0, -35.1],
      ],
    ],
  },
];

const sections: MainSectionInput[] = [
  { officialNumber: 1, trustStart: [172.7, -34.5], trustEnd: [172.8, -34.7] },
  { officialNumber: 2, trustStart: [172.8, -34.70001], trustEnd: [173.0, -35.1] },
];

function runPipelineOnce() {
  const island = assembleIslandLine(regions, 'NI');
  const resolved = resolveMainSectionBoundaries(island, sections, {
    thresholdMeters: 200,
    sharedBoundaryToleranceMeters: 5,
    allMainOfficialNumbers: sections.map((s) => s.officialNumber),
  });

  const results = sections.map((section) => {
    const start = resolved.startCuts.get(section.officialNumber)!;
    const end = resolved.endCuts.get(section.officialNumber)!;
    if (!start.cut || !end.cut) {
      return { officialNumber: section.officialNumber, produced: false as const };
    }
    const sliced = sliceBetweenCuts(island.parts, start.cut, end.cut);
    if (!sliced.ok) {
      return { officialNumber: section.officialNumber, produced: false as const, error: sliced.error };
    }
    return { officialNumber: section.officialNumber, produced: true as const, geometry: dedupeGeometry(sliced.geometry) };
  });

  return { island, resolved, results };
}

describe('end-to-end determinism/idempotency', () => {
  it('produces byte-identical results across repeated runs on the same input', () => {
    const first = runPipelineOnce();
    const second = runPipelineOnce();
    const third = runPipelineOnce();

    expect(JSON.stringify(first.results)).toBe(JSON.stringify(second.results));
    expect(JSON.stringify(second.results)).toBe(JSON.stringify(third.results));

    // Sanity: this fixture should actually produce real geometry, not just
    // trivially-equal empty results.
    expect(first.results.every((r) => r.produced)).toBe(true);
  });

  it('is not sensitive to re-running the assembly step (no incidental array mutation leaking between runs)', () => {
    // assembleIslandLine mutates array contents in place when reversing;
    // guard against a regression where re-running against the same `regions`
    // fixture object silently double-reverses or corrupts it.
    const firstIsland = assembleIslandLine(regions, 'NI');
    const secondIsland = assembleIslandLine(regions, 'NI');
    expect(JSON.stringify(firstIsland)).toBe(JSON.stringify(secondIsland));
  });
});
