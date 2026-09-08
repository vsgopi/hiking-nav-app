import { stitchWaysIntoParts, validatePart, haversineMeters } from '../ingest-te-araroa';
import type { Part } from '../lib/types';

describe('stitchWaysIntoParts — Manawatū-Whanganui-style legitimate large gap', () => {
  // Regression test for the Phase 2.1 diagnosis of the Manawatū-Whanganui
  // region failure: a ~105km gap between the "National Park to Whanganui
  // River" and "Bulls to Feilding" sub-relations, corresponding to the real
  // (unmapped-as-a-hiking-way) Whanganui River kayak/canoe leg. Confirmed via
  // live diagnosis that this gap is correctly excluded from distance, not
  // duplicated, and does not corrupt the surrounding ways.
  it('starts a new part for a large real gap without duplicating or corrupting either side', () => {
    const beforeGap: Part = [
      [175.39, -39.15],
      [175.35, -39.2],
      [175.3, -39.28], // approx. end of "National Park to Whanganui River"
    ];
    const afterGapWay1: Part = [
      [175.38, -40.17], // approx. start of "Bulls to Feilding" (Bulls)
      [175.4, -40.2],
    ];
    const parts = stitchWaysIntoParts([beforeGap, afterGapWay1], 'Manawatū-Whanganui (synthetic)');

    expect(parts).toHaveLength(2); // real gap -> new part, not joined
    expect(parts[0]).toEqual(beforeGap);
    expect(parts[1]).toEqual(afterGapWay1);
    // No duplication: total point count is exactly the sum of the inputs.
    const totalPoints = parts.reduce((sum, p) => sum + p.length, 0);
    expect(totalPoints).toBe(beforeGap.length + afterGapWay1.length);
  });

  it('both sides of a legitimate large gap independently pass geometry validation', () => {
    // Closely-spaced points (as real trail data actually is), not the sparse
    // region-boundary approximations from the previous test — this test is
    // specifically about validatePart's own per-point jump check passing
    // when points ARE realistically close together.
    const beforeGap: Part = [
      [175.39, -39.15],
      [175.389, -39.151],
      [175.388, -39.152],
    ];
    const afterGap: Part = [
      [175.38, -40.17],
      [175.381, -40.171],
    ];
    const parts = stitchWaysIntoParts([beforeGap, afterGap], 'test');
    expect(() => parts.forEach((p, i) => validatePart(p, `part ${i}`))).not.toThrow();
  });
});

describe('validatePart — Canterbury-style internal jump detection', () => {
  // Regression test for the Canterbury region failure: diagnosis found
  // several 1.8-4.7km internal jumps inside one very large stitched part
  // (way endpoints were close enough to stitch, but produced a
  // geometrically-wrong internal discontinuity once joined). validatePart's
  // existing 2km jump check is exactly what caught this — this test locks
  // that behavior in rather than letting a future change silently loosen it.
  it('rejects a part with an internal jump beyond MAX_JUMP_WITHIN_FEATURE_KM even when no single way endpoint gap exceeded the stitch threshold', () => {
    const part: Part = [
      [171.36, -43.9],
      [171.365, -43.902],
      [171.3642, -43.9032], // end of one way
      [171.3502, -43.9232], // ~2.5km away — the diagnosed jump, but within the 300m *stitch* check's per-way endpoint comparison in a larger multi-way chain
      [171.349, -43.924],
    ];
    expect(() => validatePart(part, 'Canterbury part (synthetic)')).toThrow(/jump/);
  });

  it('accepts a part whose internal points stay within the jump tolerance', () => {
    const part: Part = [
      [171.36, -43.9],
      [171.361, -43.901],
      [171.362, -43.902],
    ];
    expect(() => validatePart(part, 'ok part')).not.toThrow();
  });
});

describe('haversineMeters sanity (used throughout stitching/matching)', () => {
  it('computes a known short distance accurately', () => {
    // ~0.01 degree of longitude at the equator is ~1.113km.
    const d = haversineMeters([0, 0], [0.01, 0]);
    expect(d).toBeGreaterThan(1100);
    expect(d).toBeLessThan(1130);
  });

  it('returns 0 for identical points', () => {
    expect(haversineMeters([175, -40], [175, -40])).toBe(0);
  });
});
