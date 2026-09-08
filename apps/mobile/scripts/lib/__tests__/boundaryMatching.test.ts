import {
  matchBypassSection,
  resolveMainSectionBoundaries,
  type MainSectionInput,
} from '../boundaryMatching';
import type { BypassCandidate, IslandLine } from '../types';

// A straight equator line: 0.01 deg longitude ≈ 1.113km, so distances are
// easy to reason about precisely (same convention already used in
// NavigationEngine.test.ts elsewhere in this repo).
const straightIsland: IslandLine = {
  island: 'NI',
  partRegionIds: ['testregion'],
  parts: [
    [
      [0, 0],
      [0.01, 0],
      [0.02, 0],
      [0.03, 0],
      [0.04, 0],
      [0.05, 0],
    ],
  ],
};

const DEFAULT_OPTIONS = { thresholdMeters: 200, sharedBoundaryToleranceMeters: 5, allMainOfficialNumbers: [1, 2, 3, 4, 5] };

describe('resolveMainSectionBoundaries — shared boundary reuse', () => {
  it('reuses one resolved cut for two adjacent sections whose Trust endpoints agree within tolerance', () => {
    const sections: MainSectionInput[] = [
      { officialNumber: 1, trustStart: [0, 0], trustEnd: [0.02, 0.00002] }, // ~2.2m off the line
      { officialNumber: 2, trustStart: [0.02, 0.00001], trustEnd: [0.05, 0] }, // ~1.1m off — within 5m tolerance of the above
    ];
    const result = resolveMainSectionBoundaries(straightIsland, sections, DEFAULT_OPTIONS);

    expect(result.sharedBoundaryFlags).toHaveLength(0);
    const end1 = result.endCuts.get(1)!;
    const start2 = result.startCuts.get(2)!;
    expect(end1.report.matched).toBe(true);
    expect(start2.report.matched).toBe(true);
    expect(start2.report.matchedCoordinate).toEqual(end1.report.matchedCoordinate);
    expect(start2.report.distanceAlongIslandKm).toEqual(end1.report.distanceAlongIslandKm);
  });
});

describe('resolveMainSectionBoundaries — shared boundary inconsistency', () => {
  it('flags the pair and resolves each side independently when the Trust endpoints disagree beyond tolerance', () => {
    const sections: MainSectionInput[] = [
      { officialNumber: 1, trustStart: [0, 0], trustEnd: [0.02, 0] }, // near (0.02, 0)
      { officialNumber: 2, trustStart: [0.03, 0], trustEnd: [0.05, 0] }, // near (0.03, 0) — ~1.1km away, not a real match
    ];
    const result = resolveMainSectionBoundaries(straightIsland, sections, DEFAULT_OPTIONS);

    expect(result.sharedBoundaryFlags).toHaveLength(1);
    expect(result.sharedBoundaryFlags[0].betweenOfficialNumbers).toEqual([1, 2]);
    expect(result.sharedBoundaryFlags[0].distanceMeters).toBeGreaterThan(1000);

    const end1 = result.endCuts.get(1)!;
    const start2 = result.startCuts.get(2)!;
    expect(end1.report.matched).toBe(true);
    expect(start2.report.matched).toBe(true);
    // Independently resolved — not forced to the same point.
    expect(start2.report.matchedCoordinate).not.toEqual(end1.report.matchedCoordinate);
  });
});

describe('resolveMainSectionBoundaries — threshold failure', () => {
  it('leaves a boundary unmatched (no cut) when nothing on the island is within the configured threshold', () => {
    const sections: MainSectionInput[] = [
      // ~1.1km perpendicular off the line — far beyond the 200m default threshold.
      { officialNumber: 1, trustStart: [0, 0.01], trustEnd: [0.05, 0] },
    ];
    const result = resolveMainSectionBoundaries(straightIsland, sections, DEFAULT_OPTIONS);
    const start1 = result.startCuts.get(1)!;
    expect(start1.report.matched).toBe(false);
    expect(start1.cut).toBeNull();
    // A legitimate close match is unaffected.
    const end1 = result.endCuts.get(1)!;
    expect(end1.report.matched).toBe(true);
  });

  it('respects a smaller configured threshold that would otherwise have passed', () => {
    const sections: MainSectionInput[] = [
      { officialNumber: 1, trustStart: [0, 0.0001], trustEnd: [0.05, 0] }, // ~11m off
    ];
    const strict = resolveMainSectionBoundaries(straightIsland, sections, { ...DEFAULT_OPTIONS, thresholdMeters: 5 });
    expect(strict.startCuts.get(1)!.report.matched).toBe(false);

    const lenient = resolveMainSectionBoundaries(straightIsland, sections, { ...DEFAULT_OPTIONS, thresholdMeters: 200 });
    expect(lenient.startCuts.get(1)!.report.matched).toBe(true);
  });
});

describe('resolveMainSectionBoundaries — true catalog adjacency (Priority 4 cosmetic-bug fix)', () => {
  it('does not treat two sections as sharing a boundary when they are not truly adjacent in the catalog', () => {
    // Sections 1 and 5 are passed consecutively (as if 2/3/4 were excluded
    // this run, e.g. source_region_failed), but the full catalog says 2/3/4
    // exist between them — must not be flagged or shared as if adjacent.
    const sections: MainSectionInput[] = [
      { officialNumber: 1, trustStart: [0, 0], trustEnd: [0.02, 0] },
      { officialNumber: 5, trustStart: [0.03, 0], trustEnd: [0.05, 0] },
    ];
    const result = resolveMainSectionBoundaries(straightIsland, sections, {
      thresholdMeters: 200,
      sharedBoundaryToleranceMeters: 5,
      allMainOfficialNumbers: [1, 2, 3, 4, 5], // 2,3,4 exist in the catalog, even though absent here
    });
    expect(result.sharedBoundaryFlags).toHaveLength(0); // no spurious [1,5] flag
    expect(result.endCuts.get(1)!.report.matched).toBe(true);
    expect(result.startCuts.get(5)!.report.matched).toBe(true);
  });

  it('still shares/flags normally when sections ARE truly catalog-adjacent', () => {
    const sections: MainSectionInput[] = [
      { officialNumber: 1, trustStart: [0, 0], trustEnd: [0.02, 0] },
      { officialNumber: 2, trustStart: [0.03, 0], trustEnd: [0.05, 0] },
    ];
    const result = resolveMainSectionBoundaries(straightIsland, sections, {
      thresholdMeters: 200,
      sharedBoundaryToleranceMeters: 5,
      allMainOfficialNumbers: [1, 2],
    });
    expect(result.sharedBoundaryFlags).toHaveLength(1); // genuine inconsistency, correctly flagged
  });

  it('treats bypass-numbered gaps (e.g. 42 -> 44, bypass 43 in between) as true adjacency, unaffected by this fix', () => {
    const sections: MainSectionInput[] = [
      { officialNumber: 42, trustStart: [0, 0], trustEnd: [0.02, 0.00001] },
      { officialNumber: 44, trustStart: [0.02, 0], trustEnd: [0.05, 0] },
    ];
    const result = resolveMainSectionBoundaries(straightIsland, sections, {
      thresholdMeters: 200,
      sharedBoundaryToleranceMeters: 5,
      allMainOfficialNumbers: [42, 44], // 43 is a bypass, never in this main-only list
    });
    expect(result.sharedBoundaryFlags).toHaveLength(0);
    expect(result.endCuts.get(42)!.report.matchedCoordinate).toEqual(result.startCuts.get(44)!.report.matchedCoordinate);
  });
});

describe('resolveMainSectionBoundaries — Trust GPX orientation detection (real #58 case)', () => {
  it('detects a section recorded end-to-start relative to its neighbors and uses it in the walked direction', () => {
    // Reproduces the real evidence for section 58 (Escarpment Track):
    // section 57 ends at P1; section 58's own file runs P2->P1 (i.e. its
    // "end" is P1, matching 57, not its "start"); section 59 starts at P2,
    // matching 58's own "start". The hiker actually walks 58 P1->P2.
    const P1: [number, number] = [0.02, 0];
    const P2: [number, number] = [0.03, 0];
    const sections: MainSectionInput[] = [
      { officialNumber: 57, trustStart: [0, 0], trustEnd: P1 },
      { officialNumber: 58, trustStart: P2, trustEnd: P1 }, // recorded backwards
      { officialNumber: 59, trustStart: P2, trustEnd: [0.05, 0] },
    ];
    const result = resolveMainSectionBoundaries(straightIsland, sections, {
      thresholdMeters: 200,
      sharedBoundaryToleranceMeters: 5,
      allMainOfficialNumbers: [57, 58, 59],
    });

    // No spurious inconsistency flags — the orientation check resolves both joins cleanly.
    expect(result.sharedBoundaryFlags).toHaveLength(0);
    // 57's end and 58's start-cut must be the same physical point (P1).
    expect(result.endCuts.get(57)!.report.matchedCoordinate).toEqual(result.startCuts.get(58)!.report.matchedCoordinate);
    // 58's end-cut and 59's start-cut must be the same physical point (P2).
    expect(result.endCuts.get(58)!.report.matchedCoordinate).toEqual(result.startCuts.get(59)!.report.matchedCoordinate);
    // Ordering must be correct: 58 walked P1 -> P2 (increasing along-line position).
    const s58start = result.startCuts.get(58)!.report.distanceAlongIslandKm!;
    const s58end = result.endCuts.get(58)!.report.distanceAlongIslandKm!;
    expect(s58end).toBeGreaterThan(s58start);
  });

  it('still flags a genuine inconsistency when none of the four pairings match', () => {
    const sections: MainSectionInput[] = [
      { officialNumber: 1, trustStart: [0, 0], trustEnd: [0.02, 0] },
      { officialNumber: 2, trustStart: [0.035, 0], trustEnd: [0.045, 0] }, // neither end is near (0.02,0)
    ];
    const result = resolveMainSectionBoundaries(straightIsland, sections, {
      thresholdMeters: 200,
      sharedBoundaryToleranceMeters: 5,
      allMainOfficialNumbers: [1, 2],
    });
    expect(result.sharedBoundaryFlags).toHaveLength(1);
  });
});

describe('matchBypassSection — joint two-point candidate scoring', () => {
  it('rejects a candidate that is only close to one of the two boundaries, in favor of one that is close to both', () => {
    const goodCandidate: BypassCandidate = {
      id: 'good',
      name: 'Good Candidate',
      parts: [
        [
          [0.1, 0.00005], // ~5.5m off — close to both ends
          [0.11, 0.00005],
          [0.12, 0.00005],
        ],
      ],
    };
    const partialCandidate: BypassCandidate = {
      id: 'partial',
      name: 'Partial Candidate (a different, nearby track)',
      parts: [
        // Very close to the start point, but doesn't extend anywhere near the end point.
        [
          [0.1, 0.000005],
          [0.101, 0.000005],
        ],
      ],
    };

    const section = { officialNumber: 20, trustStart: [0.1, 0] as [number, number], trustEnd: [0.12, 0] as [number, number] };
    const result = matchBypassSection(section, [partialCandidate, goodCandidate], 200);

    expect(result.matchedCandidateId).toBe('good');
    expect(result.startReport.matched).toBe(true);
    expect(result.endReport.matched).toBe(true);
  });

  it('reports no match when no candidate clears the threshold for both boundaries', () => {
    const farCandidate: BypassCandidate = {
      id: 'far',
      name: 'Far Candidate',
      parts: [
        [
          [0.5, 0.01],
          [0.51, 0.01],
        ],
      ],
    };
    const section = { officialNumber: 20, trustStart: [0.1, 0] as [number, number], trustEnd: [0.12, 0] as [number, number] };
    const result = matchBypassSection(section, [farCandidate], 200);
    expect(result.matchedCandidateId).toBeNull();
    expect(result.startReport.matched).toBe(false);
    expect(result.endReport.matched).toBe(false);
  });

  it('reports no match (not an error) when there are zero candidates', () => {
    const section = { officialNumber: 20, trustStart: [0.1, 0] as [number, number], trustEnd: [0.12, 0] as [number, number] };
    const result = matchBypassSection(section, [], 200);
    expect(result.matchedCandidateId).toBeNull();
  });

  // Regression test for the real root cause of bypass #22 (Puhoi to
  // Wenderholm Walk Bypass): the diagnostic confirmed the winning OSM
  // alternate-relation candidate was the correct, only physically-matching
  // one (both distances well within threshold) — it was simply authored in
  // the opposite direction to the Trust's own SOBO convention, so
  // independently-nearest-matching each boundary produced a reversed slice.
  it('detects and corrects a candidate authored in the opposite direction (bypass #22 root cause)', () => {
    // Candidate's own coordinates run end-to-start relative to the Trust's
    // start/end anchors, exactly as diagnosed for relation 9379642.
    const reversedCandidate: BypassCandidate = {
      id: '9379642',
      name: 'Te Araroa alternative route',
      parts: [
        [
          [0.12, 0], // == trustEnd
          [0.11, 0],
          [0.1, 0], // == trustStart
        ],
      ],
    };
    const section = { officialNumber: 22, trustStart: [0.1, 0] as [number, number], trustEnd: [0.12, 0] as [number, number] };
    const result = matchBypassSection(section, [reversedCandidate], 200);

    expect(result.matchedCandidateId).toBe('9379642');
    expect(result.startCut).not.toBeNull();
    expect(result.endCut).not.toBeNull();
    // After correction, start must precede end (not a reversed/degenerate slice).
    if (result.startCut && result.endCut) {
      const reversed = result.startCut.partIndex > result.endCut.partIndex ||
        (result.startCut.partIndex === result.endCut.partIndex && result.startCut.segmentIndex > result.endCut.segmentIndex);
      expect(reversed).toBe(false);
    }
  });

  it('leaves a genuinely ambiguous/self-crossing candidate unresolved rather than guessing when reversal does not fix the order', () => {
    // A candidate where reversing STILL produces a reversed order relative to
    // one of the two anchors — e.g. it loops back near itself — must not be
    // silently forced through.
    const selfCrossingCandidate: BypassCandidate = {
      id: 'weird',
      name: 'Self-crossing candidate',
      parts: [
        [
          [0.1, 0], // == trustStart
          [0.15, 0],
          [0.12, 0], // == trustEnd, but BEFORE trustStart's second near-occurrence below
          [0.05, 0],
          [0.1, 0.0001], // a second occurrence very close to trustStart, further along
        ],
      ],
    };
    const section = { officialNumber: 22, trustStart: [0.1, 0] as [number, number], trustEnd: [0.12, 0] as [number, number] };
    const result = matchBypassSection(section, [selfCrossingCandidate], 200);
    // Whatever the matcher decides, it must not report success with a
    // reversed cut — either it matches correctly (nearest occurrence happens
    // to be first) or it fails; both are acceptable outcomes here, a silent
    // reversed "success" is not.
    if (result.matchedCandidateId && result.startCut && result.endCut) {
      const reversed = result.startCut.partIndex > result.endCut.partIndex ||
        (result.startCut.partIndex === result.endCut.partIndex && result.startCut.segmentIndex > result.endCut.segmentIndex);
      expect(reversed).toBe(false);
    }
  });
});
