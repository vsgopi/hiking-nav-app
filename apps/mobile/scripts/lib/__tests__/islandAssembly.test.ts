import { assembleIslandLine, type RegionInput } from '../islandAssembly';

// Roughly NZ North Island-shaped latitudes (Cape Reinga ~ -34.4, further
// south is more negative), so the anchor-based orientation check has a real
// north/south difference to detect, not an arbitrary synthetic line.
function region(regionId: string, sequence: number, latStart: number, latEnd: number): RegionInput {
  return {
    regionId,
    island: 'NI',
    sequence,
    parts: [
      [
        [173.0, latStart],
        [173.0, (latStart + latEnd) / 2],
        [173.0, latEnd],
      ],
    ],
  };
}

describe('assembleIslandLine', () => {
  it('concatenates regions in sequence order without stitching across them', () => {
    const regions = [region('northland', 1, -34.5, -35.5), region('auckland', 2, -35.5, -37.0)];
    const island = assembleIslandLine(regions, 'NI');
    expect(island.parts).toHaveLength(2); // never merged into one part
    expect(island.partRegionIds).toEqual(['northland', 'auckland']);
    expect(island.parts[0][0][1]).toBeCloseTo(-34.5, 5); // already correctly oriented, no reversal needed
  });

  it('orients ordinary sequence order regardless of input array order (sequence, not array position, decides order)', () => {
    const regions = [region('auckland', 2, -35.5, -37.0), region('northland', 1, -34.5, -35.5)];
    const island = assembleIslandLine(regions, 'NI');
    expect(island.partRegionIds).toEqual(['northland', 'auckland']);
  });

  it('seeds the first region\'s direction from the geographic anchor when it is internally reversed', () => {
    // This region's own coordinates run from far-from-Cape-Reinga to close-to-it — backwards.
    const regions = [region('northland', 1, -35.5, -34.5)];
    const island = assembleIslandLine(regions, 'NI');
    expect(island.parts[0][0][1]).toBeCloseTo(-34.5, 1); // corrected: close-to-anchor end now first
    expect(island.parts[0][island.parts[0].length - 1][1]).toBeCloseTo(-35.5, 1);
  });

  it('orients a reversed FIRST region using its next neighbor, not a distant fixed anchor (Marlborough Sounds regression)', () => {
    // Regression test for the real bug found in the Phase 2.1 live run:
    // Marlborough is SI's first region, ~700km from the Bluff anchor.
    // Anchoring it directly against Bluff was too weak a signal and
    // produced a reversed Marlborough line, which in turn caused sections
    // 66-68 (Queen Charlotte Track onward) to resolve in reversed order
    // even though each individual boundary matched within threshold.
    //
    // Marlborough here is deliberately built backwards (its own coordinates
    // run away-from-Tasman -> toward-Tasman), at a latitude close to the SI
    // island average — the kind of case where the old anchor-only heuristic
    // could plausibly get the direction wrong, while comparing against the
    // immediate next region (Tasman) cannot.
    const marlboroughBackwards: RegionInput = {
      regionId: 'marlborough',
      island: 'SI',
      sequence: 1,
      parts: [
        [
          [173.9, -41.3], // far from Tasman's own start
          [174.1, -41.15],
          [174.23, -41.09], // near Ship Cove — should end up LAST after correction
        ],
      ],
    };
    const tasman: RegionInput = {
      regionId: 'tasman',
      island: 'SI',
      sequence: 2,
      parts: [
        [
          [173.55, -41.4], // close to Marlborough's own start (173.9,-41.3 region) — the real connecting point
          [173.2, -41.5],
        ],
      ],
    };

    const island = assembleIslandLine([marlboroughBackwards, tasman], 'SI');

    // After correction, Marlborough's own LAST point must be the one nearest
    // Tasman's start — i.e. Marlborough was reversed.
    const marlboroughPart = island.parts[0];
    expect(marlboroughPart[marlboroughPart.length - 1]).toEqual([173.9, -41.3]);
    expect(marlboroughPart[0]).toEqual([174.23, -41.09]);
  });

  it('follows the chain to correct a later region that is internally reversed relative to its predecessor', () => {
    // northland (seq 1) is already correctly oriented: -34.5 -> -35.5.
    // auckland (seq 2) is passed in with its OWN coordinates backwards
    // relative to northland's end (-35.5): auckland's array runs
    // -37.0 -> -35.5, i.e. the point that should connect to northland
    // (-35.5) is auckland's *last* coordinate, not its first.
    const northland = region('northland', 1, -34.5, -35.5);
    const aucklandBackwards = region('auckland', 2, -37.0, -35.5);

    const island = assembleIslandLine([northland, aucklandBackwards], 'NI');

    // The whole assembled line must read -34.5 -> -35.5 -> -37.0 once corrected.
    const flat = island.parts.flat();
    expect(flat[0][1]).toBeCloseTo(-34.5, 1);
    expect(flat[flat.length - 1][1]).toBeCloseTo(-37.0, 1);
    // The join point between the two regions must be continuous (both sides ~-35.5).
    const northlandEnd = island.parts[0][island.parts[0].length - 1][1];
    const aucklandStart = island.parts[1][0][1];
    expect(northlandEnd).toBeCloseTo(-35.5, 1);
    expect(aucklandStart).toBeCloseTo(-35.5, 1);
  });

  it('ignores regions belonging to the other island', () => {
    const regions = [region('northland', 1, -34.5, -35.5), { ...region('otago', 10, -45, -46), island: 'SI' as const }];
    const island = assembleIslandLine(regions, 'NI');
    expect(island.partRegionIds).toEqual(['northland']);
  });

  it('preserves multiple parts within a single region (a region-internal gap stays a gap)', () => {
    const withGap: RegionInput = {
      regionId: 'waikato',
      island: 'NI',
      sequence: 3,
      parts: [
        [
          [175.0, -37.5],
          [175.0, -37.8],
        ],
        [
          [175.0, -38.0],
          [175.0, -38.3],
        ],
      ],
    };
    const island = assembleIslandLine([withGap], 'NI');
    expect(island.parts).toHaveLength(2);
    expect(island.partRegionIds).toEqual(['waikato', 'waikato']);
  });

  it('does not mutate its input (safe to call repeatedly on the same RegionInput[])', () => {
    const northland = region('northland', 1, -35.5, -34.5); // backwards, will be corrected
    const before = JSON.stringify(northland);
    assembleIslandLine([northland], 'NI');
    assembleIslandLine([northland], 'NI');
    expect(JSON.stringify(northland)).toBe(before);
  });
});
