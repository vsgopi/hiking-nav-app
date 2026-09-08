import { dedupeGeometry, sliceBetweenCuts, type SlicedGeometry } from '../sectionSlicing';
import type { Part, ResolvedCut } from '../types';

const partA: Part = [
  [0, 0],
  [0.01, 0],
  [0.02, 0],
  [0.03, 0],
];
// A real gap between partA's end (0.03,0) and partB's start (0.05,0).
const partB: Part = [
  [0.05, 0],
  [0.06, 0],
  [0.07, 0],
];
// A second real gap before partC.
const partC: Part = [
  [0.09, 0],
  [0.1, 0],
];
const parts: Part[] = [partA, partB, partC];

describe('sliceBetweenCuts — same part (LineString)', () => {
  it('slices within one part, keeping only the original vertices strictly between the two cuts', () => {
    const start: ResolvedCut = { partIndex: 0, segmentIndex: 0, coordinate: [0.005, 0] };
    const end: ResolvedCut = { partIndex: 0, segmentIndex: 2, coordinate: [0.025, 0] };
    const result = sliceBetweenCuts(parts, start, end);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.geometry).toEqual({
        type: 'LineString',
        coordinates: [
          [0.005, 0],
          [0.01, 0],
          [0.02, 0],
          [0.025, 0],
        ],
      });
    }
  });

  it('handles both cuts on the same segment (adjacent, no interior vertices)', () => {
    const start: ResolvedCut = { partIndex: 0, segmentIndex: 1, coordinate: [0.012, 0] };
    const end: ResolvedCut = { partIndex: 0, segmentIndex: 1, coordinate: [0.018, 0] };
    const result = sliceBetweenCuts(parts, start, end);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.geometry).toEqual({
        type: 'LineString',
        coordinates: [
          [0.012, 0],
          [0.018, 0],
        ],
      });
    }
  });

  it('flags reversed order within the same part as an order violation, not a fabricated slice', () => {
    const start: ResolvedCut = { partIndex: 0, segmentIndex: 2, coordinate: [0.025, 0] };
    const end: ResolvedCut = { partIndex: 0, segmentIndex: 0, coordinate: [0.005, 0] };
    const result = sliceBetweenCuts(parts, start, end);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('order_violation');
  });
});

describe('sliceBetweenCuts — different parts (MultiLineString), real gaps preserved', () => {
  it('produces a MultiLineString spanning two parts, with the gap between them intact', () => {
    const start: ResolvedCut = { partIndex: 0, segmentIndex: 2, coordinate: [0.025, 0] };
    const end: ResolvedCut = { partIndex: 1, segmentIndex: 1, coordinate: [0.065, 0] };
    const result = sliceBetweenCuts(parts, start, end);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.geometry.type).toBe('MultiLineString');
      const g = result.geometry as Extract<SlicedGeometry, { type: 'MultiLineString' }>;
      expect(g.coordinates).toEqual([
        [
          [0.025, 0],
          [0.03, 0],
        ],
        [
          [0.05, 0],
          [0.06, 0],
          [0.065, 0],
        ],
      ]);
      // No point was inserted to bridge 0.03 -> 0.05 — the real gap survives untouched.
      const flat = g.coordinates.flat();
      expect(flat.some(([lon]) => lon > 0.03 && lon < 0.05)).toBe(false);
    }
  });

  it('preserves a fully-intermediate part untouched when a section spans three parts', () => {
    const start: ResolvedCut = { partIndex: 0, segmentIndex: 2, coordinate: [0.025, 0] };
    const end: ResolvedCut = { partIndex: 2, segmentIndex: 0, coordinate: [0.095, 0] };
    const result = sliceBetweenCuts(parts, start, end);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const g = result.geometry as Extract<SlicedGeometry, { type: 'MultiLineString' }>;
      expect(g.coordinates).toHaveLength(3);
      // partB appears in full, unmodified, as the middle part.
      expect(g.coordinates[1]).toEqual(partB);
    }
  });

  it('flags a start-cut in a later part than the end-cut as an order violation', () => {
    const start: ResolvedCut = { partIndex: 1, segmentIndex: 0, coordinate: [0.055, 0] };
    const end: ResolvedCut = { partIndex: 0, segmentIndex: 1, coordinate: [0.015, 0] };
    const result = sliceBetweenCuts(parts, start, end);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('order_violation');
  });
});

describe('dedupeGeometry', () => {
  it('removes consecutive exact duplicate points in a LineString', () => {
    const geometry: SlicedGeometry = {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [0.01, 0],
        [0.01, 0],
        [0.02, 0],
      ],
    };
    expect(dedupeGeometry(geometry)).toEqual({
      type: 'LineString',
      coordinates: [
        [0, 0],
        [0.01, 0],
        [0.02, 0],
      ],
    });
  });

  it('removes consecutive duplicates independently within each MultiLineString part', () => {
    const geometry: SlicedGeometry = {
      type: 'MultiLineString',
      coordinates: [
        [
          [0, 0],
          [0, 0],
          [0.01, 0],
        ],
        [
          [0.05, 0],
          [0.06, 0],
          [0.06, 0],
        ],
      ],
    };
    expect(dedupeGeometry(geometry)).toEqual({
      type: 'MultiLineString',
      coordinates: [
        [
          [0, 0],
          [0.01, 0],
        ],
        [
          [0.05, 0],
          [0.06, 0],
        ],
      ],
    });
  });

  it('does not remove non-adjacent duplicates (e.g. a path crossing itself)', () => {
    const geometry: SlicedGeometry = {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [0.01, 0],
        [0, 0],
      ],
    };
    expect(dedupeGeometry(geometry).coordinates).toHaveLength(3);
  });
});
