import { checkLengthConfidence, findIntervalOverlaps } from '../matchConfidence';

describe('checkLengthConfidence', () => {
  it('is ok with no official distance to compare against', () => {
    expect(checkLengthConfidence(10, null).confidence).toBe('ok');
  });

  it('is ok within warn tolerance', () => {
    expect(checkLengthConfidence(10, 9.5).confidence).toBe('ok');
  });

  it('is low_confidence between warn and fail tolerance', () => {
    expect(checkLengthConfidence(12, 10).confidence).toBe('low_confidence'); // 20% diff
  });

  it('rejects beyond fail tolerance', () => {
    expect(checkLengthConfidence(20, 10).confidence).toBe('reject'); // 100% diff
  });

  // Regression: sections #6, #12, #60, #69 from the Phase 2 live run — both
  // boundaries matched within threshold, correct order, but the resulting
  // slice was wildly off the Trust's own published distance. These must all
  // be rejected, not silently accepted as "matched".
  it.each([
    ['#6 Paihia to Opua', 0.55, 8.96],
    ['#12 Pataua North to Whangarei Heads', 116.41, 33.86],
    ['#60 Rangituhi Colonial Knob Walk', 42.23, 23.16],
    ['#69 Richmond Alpine Track', 246.83, 95.72],
  ])('rejects the diagnosed real case %s', (_label, computedKm, officialKm) => {
    expect(checkLengthConfidence(computedKm, officialKm).confidence).toBe('reject');
  });
});

describe('findIntervalOverlaps', () => {
  it('does not flag adjacent sections that touch at a shared boundary', () => {
    const overlaps = findIntervalOverlaps([
      { officialNumber: 1, fromKm: 0, toKm: 10 },
      { officialNumber: 2, fromKm: 10, toKm: 20 },
    ]);
    expect(overlaps).toHaveLength(0);
  });

  it('flags two non-adjacent sections whose resolved intervals substantially overlap', () => {
    const overlaps = findIntervalOverlaps([
      { officialNumber: 1, fromKm: 0, toKm: 10 },
      { officialNumber: 2, fromKm: 10, toKm: 20 },
      { officialNumber: 3, fromKm: 5, toKm: 15 }, // overlaps both 1 and 2, non-adjacent to either by number... adjacent to 2
    ]);
    // 3 vs 1: overlap [5,10], non-adjacent (diff=2) -> flagged
    const entryFor1 = overlaps.find((o) => o.officialNumber === 1);
    const entryFor3 = overlaps.find((o) => o.officialNumber === 3);
    expect(entryFor1?.overlapsWith).toContain(3);
    expect(entryFor3?.overlapsWith).toContain(1);
  });

  it('does not flag a small overlap within tolerance (floating-point boundary noise)', () => {
    const overlaps = findIntervalOverlaps([
      { officialNumber: 1, fromKm: 0, toKm: 10.001 },
      { officialNumber: 5, fromKm: 9.999, toKm: 20 },
    ]);
    expect(overlaps).toHaveLength(0);
  });

  it('ignores sections with no overlap at all', () => {
    const overlaps = findIntervalOverlaps([
      { officialNumber: 1, fromKm: 0, toKm: 10 },
      { officialNumber: 5, fromKm: 50, toKm: 60 },
    ]);
    expect(overlaps).toHaveLength(0);
  });
});
