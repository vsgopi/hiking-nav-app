/**
 * Additional deterministic safeguards beyond "nearest point + threshold +
 * traversal order" — added after the Phase 2 live run proved that trio
 * insufficient for sections where the route passes close to itself (e.g.
 * sections #6, #12, #60, #69: both boundaries matched within threshold, in
 * the correct order, yet the resulting slice was 94%-244% off the Trust's
 * own published distance, because the match landed on a spatially-nearby
 * but topologically-wrong stretch of the line).
 *
 * official_distance_km is used here ONLY as evidence to flag/reject a
 * technically-valid slice — never to cut, force, or adjust a slice toward
 * that number. See Priority 4 of the Phase 2.1 diagnostic pass.
 */

export const LENGTH_WARN_TOLERANCE = 0.15;
export const LENGTH_FAIL_TOLERANCE = 0.4;

export type LengthConfidence = 'ok' | 'low_confidence' | 'reject';

export interface LengthCheckResult {
  confidence: LengthConfidence;
  diffPct: number | null;
}

/** Flag-only sanity check against the Trust's published distance — 'reject' means the slice must not be trusted as real geometry, not that the underlying OSM data is bad. */
export function checkLengthConfidence(computedKm: number, officialDistanceKm: number | null): LengthCheckResult {
  if (officialDistanceKm === null || officialDistanceKm <= 0) return { confidence: 'ok', diffPct: null };
  const diffPct = Math.abs(computedKm - officialDistanceKm) / officialDistanceKm;
  if (diffPct > LENGTH_FAIL_TOLERANCE) return { confidence: 'reject', diffPct };
  if (diffPct > LENGTH_WARN_TOLERANCE) return { confidence: 'low_confidence', diffPct };
  return { confidence: 'ok', diffPct };
}

export interface ResolvedInterval {
  officialNumber: number;
  fromKm: number;
  toKm: number;
}

export interface IntervalOverlap {
  officialNumber: number;
  overlapsWith: number[];
}

/**
 * Flags a section whose resolved along-island interval overlaps another
 * non-adjacent section's interval by more than a small tolerance — a sign
 * the match landed inside a different section's real territory (a distinct
 * self-proximity signature from the pure length check: a wrong match can
 * coincidentally have a plausible length while still landing in the wrong
 * place). Adjacent sections (by official_number) are expected to touch at a
 * shared boundary and are not flagged for that alone.
 */
export function findIntervalOverlaps(intervals: ResolvedInterval[], toleranceKm = 0.1): IntervalOverlap[] {
  const sorted = [...intervals].sort((a, b) => a.fromKm - b.fromKm);
  const overlaps = new Map<number, Set<number>>();

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      const isAdjacentByNumber = Math.abs(a.officialNumber - b.officialNumber) === 1;
      const overlapAmount = Math.min(a.toKm, b.toKm) - Math.max(a.fromKm, b.fromKm);
      if (overlapAmount > toleranceKm && !isAdjacentByNumber) {
        if (!overlaps.has(a.officialNumber)) overlaps.set(a.officialNumber, new Set());
        if (!overlaps.has(b.officialNumber)) overlaps.set(b.officialNumber, new Set());
        overlaps.get(a.officialNumber)!.add(b.officialNumber);
        overlaps.get(b.officialNumber)!.add(a.officialNumber);
      }
    }
  }

  return [...overlaps.entries()].map(([officialNumber, others]) => ({
    officialNumber,
    overlapsWith: [...others].sort((x, y) => x - y),
  }));
}
