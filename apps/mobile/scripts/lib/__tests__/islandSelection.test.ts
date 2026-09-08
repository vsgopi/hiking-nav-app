import { determineIslandFromMetadata, resolveAmbiguousIsland } from '../islandSelection';
import type { IslandLine } from '../types';

describe('determineIslandFromMetadata', () => {
  // Regression test for the real bug found in the Phase 2 live run: sections
  // 66-68 (Queen Charlotte Track, Anakiwa to Pelorus Bridge, Pelorus River
  // Track — all Marlborough Sounds) were misclassified as North Island by a
  // `latitude > -41.4` heuristic, because Ship Cove sits at ~-41.1°. Phase 1's
  // own region metadata has always known these are Marlborough (South
  // Island) — this must be used instead of any geometric heuristic.
  it.each([
    ['te-araroa-66', 'SI'], // Queen Charlotte Track
    ['te-araroa-67', 'SI'], // Anakiwa to Pelorus Bridge
    ['te-araroa-68', 'SI'], // Pelorus River Track
  ])('resolves %s to %s from Phase 1 metadata, not geometry', (sectionId, expectedIsland) => {
    expect(determineIslandFromMetadata(sectionId)).toBe(expectedIsland);
  });

  it('resolves a North Island section correctly', () => {
    expect(determineIslandFromMetadata('te-araroa-01')).toBe('NI'); // Cape Reinga to Ahipara
  });

  it('resolves the Cook Strait ferry/water-taxi sections consistently with their own metadata', () => {
    // These are travel-mode connectors, not searched against OSM at all
    // (see sectionPreflight.ts), but their region metadata must still
    // resolve deterministically for reporting purposes.
    expect(determineIslandFromMetadata('te-araroa-64')).not.toBeNull();
    expect(determineIslandFromMetadata('te-araroa-65')).not.toBeNull();
  });

  it('returns null for a section id with no region metadata at all', () => {
    expect(determineIslandFromMetadata('not-a-real-section')).toBeNull();
  });
});

describe('resolveAmbiguousIsland', () => {
  const niLine: IslandLine = {
    island: 'NI',
    partRegionIds: ['test'],
    parts: [
      [
        [175, -38],
        [175, -38.5],
      ],
    ],
  };
  const siLine: IslandLine = {
    island: 'SI',
    partRegionIds: ['test'],
    parts: [
      [
        [171, -43],
        [171, -43.5],
      ],
    ],
  };

  it('selects NI when only the NI line is within threshold', () => {
    const result = resolveAmbiguousIsland([175, -38.1], niLine, siLine, 200);
    expect(result.island).toBe('NI');
    expect(result.triedBothIslands).toBe(true);
  });

  it('selects SI when only the SI line is within threshold', () => {
    const result = resolveAmbiguousIsland([171, -43.1], niLine, siLine, 200);
    expect(result.island).toBe('SI');
  });

  it('reports ambiguity (never guesses) when neither island is within threshold', () => {
    const result = resolveAmbiguousIsland([160, -30], niLine, siLine, 200);
    expect(result.island).toBeNull();
  });

  it('reports ambiguity when both islands are somehow within threshold rather than picking one', () => {
    const overlappingSiLine: IslandLine = { ...siLine, parts: [[...niLine.parts[0]]] }; // identical to NI line
    const result = resolveAmbiguousIsland([175, -38.1], niLine, overlappingSiLine, 200);
    expect(result.island).toBeNull();
  });
});
