import { boundingBoxOf, findNearestPointOnLine, lineStringLengthKm } from '../geo';
import type { GeoLineString, GeoMultiLineString } from '../../../domain/models/TrailGeometry';

// Two straight segments along the equator, each ~1.113km, with a large gap
// between them (like two Te Araroa regions separated by the Cook Strait).
const multiLine: GeoMultiLineString = {
  type: 'MultiLineString',
  coordinates: [
    [
      [0, 0],
      [0.01, 0],
    ],
    [
      [1, 0],
      [1.01, 0],
    ],
  ],
};

const singleLine: GeoLineString = {
  type: 'LineString',
  coordinates: [
    [0, 0],
    [0.01, 0],
  ],
};

describe('lineStringLengthKm', () => {
  it('computes a LineString length', () => {
    expect(lineStringLengthKm(singleLine)).toBeCloseTo(1.113, 2);
  });

  it('sums MultiLineString part lengths without counting the gap between them', () => {
    // Each part is ~1.113km; the ~110km gap between them must not be included.
    expect(lineStringLengthKm(multiLine)).toBeCloseTo(2.226, 1);
  });
});

describe('findNearestPointOnLine', () => {
  it('finds the nearest point within the correct MultiLineString part', () => {
    const result = findNearestPointOnLine(multiLine, { longitude: 1.005, latitude: 0.001 });
    expect(result.distanceFromLineMeters).toBeLessThan(200);
  });

  it("doesn't inflate distanceAlongLine across the gap between parts", () => {
    const result = findNearestPointOnLine(multiLine, { longitude: 1, latitude: 0 });
    // Cumulative length along parts traversed so far: ~1.113km (part 1) + 0 into part 2.
    expect(result.distanceAlongLineKm).toBeCloseTo(1.113, 1);
  });
});

describe('boundingBoxOf', () => {
  it('handles a LineString', () => {
    expect(boundingBoxOf(singleLine)).toEqual([0, 0, 0.01, 0]);
  });

  it('handles a MultiLineString by flattening all parts', () => {
    expect(boundingBoxOf(multiLine)).toEqual([0, 0, 1.01, 0]);
  });
});
