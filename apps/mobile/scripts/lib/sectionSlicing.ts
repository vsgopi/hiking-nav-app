import type { Coord, Part, ResolvedCut } from './types';

export type SlicedGeometry =
  | { type: 'LineString'; coordinates: Coord[] }
  | { type: 'MultiLineString'; coordinates: Coord[][] };

export type SliceResult = { ok: true; geometry: SlicedGeometry } | { ok: false; error: string };

/**
 * Explicit part-aware slicing — this deliberately does NOT hand a
 * MultiLineString to a generic line-slice utility. It first determines which
 * part each cut falls in, then either slices within one part (LineString
 * result) or preserves every real intermediate part untouched and returns a
 * MultiLineString (never fabricating a connector across the part boundary —
 * the same "real gap ≠ fabricated join" rule the region-level stitcher
 * already follows). Traversal order is preserved throughout: parts and their
 * internal coordinates are never reordered here, only trimmed at the ends.
 */
export function sliceBetweenCuts(parts: Part[], startCut: ResolvedCut, endCut: ResolvedCut): SliceResult {
  if (startCut.partIndex === endCut.partIndex) {
    if (startCut.segmentIndex > endCut.segmentIndex) {
      return { ok: false, error: 'order_violation: end cut precedes start cut within the same part' };
    }
    const part = parts[startCut.partIndex];
    const middle = part.slice(startCut.segmentIndex + 1, endCut.segmentIndex + 1);
    const coordinates = [startCut.coordinate, ...middle, endCut.coordinate];
    if (coordinates.length < 2) {
      return { ok: false, error: 'degenerate_slice: fewer than 2 points produced' };
    }
    return { ok: true, geometry: { type: 'LineString', coordinates } };
  }

  if (startCut.partIndex > endCut.partIndex) {
    return { ok: false, error: 'order_violation: end cut is in an earlier part than the start cut' };
  }

  const firstPart = parts[startCut.partIndex];
  const firstSliced = [startCut.coordinate, ...firstPart.slice(startCut.segmentIndex + 1)];

  const fullIntermediateParts = parts.slice(startCut.partIndex + 1, endCut.partIndex).map((p) => [...p]);

  const lastPart = parts[endCut.partIndex];
  const lastSliced = [...lastPart.slice(0, endCut.segmentIndex + 1), endCut.coordinate];

  const resultParts = [firstSliced, ...fullIntermediateParts, lastSliced].filter((p) => p.length >= 2);

  if (resultParts.length === 0) {
    return { ok: false, error: 'degenerate_slice: no valid parts produced' };
  }
  if (resultParts.length === 1) {
    return { ok: true, geometry: { type: 'LineString', coordinates: resultParts[0] } };
  }
  return { ok: true, geometry: { type: 'MultiLineString', coordinates: resultParts } };
}

/** Removes exactly-repeated consecutive coordinates within each part — a real artifact risk right at cut points and at inherited way-junction stitch points. Never removes a non-adjacent duplicate (e.g. a trail crossing itself), only consecutive repeats. */
function dedupePart(part: Coord[]): Coord[] {
  const result: Coord[] = [];
  for (const coord of part) {
    const last = result[result.length - 1];
    if (!last || last[0] !== coord[0] || last[1] !== coord[1]) {
      result.push(coord);
    }
  }
  return result;
}

export function dedupeGeometry(geometry: SlicedGeometry): SlicedGeometry {
  if (geometry.type === 'LineString') {
    return { type: 'LineString', coordinates: dedupePart(geometry.coordinates) };
  }
  return { type: 'MultiLineString', coordinates: geometry.coordinates.map(dedupePart) };
}
