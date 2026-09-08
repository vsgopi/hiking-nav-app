import nearestPointOnLine from '@turf/nearest-point-on-line';
import length from '@turf/length';
import { lineString, multiLineString, point } from '@turf/helpers';
import type { Feature, LineString, MultiLineString } from 'geojson';
import type { TrailGeometryShape } from '../../domain/models/TrailGeometry';

export interface LonLat {
  longitude: number;
  latitude: number;
}

/** Builds the matching turf Feature for either a LineString or MultiLineString shape. */
function toTurfLine(shape: TrailGeometryShape): Feature<LineString | MultiLineString> {
  return shape.type === 'MultiLineString' ? multiLineString(shape.coordinates) : lineString(shape.coordinates);
}

export function lineStringLengthKm(shape: TrailGeometryShape): number {
  return length(toTurfLine(shape), { units: 'kilometers' });
}

export interface NearestPointResult {
  distanceFromLineMeters: number;
  distanceAlongLineKm: number;
  nearestCoordinate: [number, number];
}

/**
 * For a MultiLineString, `location` is the cumulative length along the parts
 * traversed up to the nearest segment — it does not add any distance for the
 * gaps between parts (e.g. the Cook Strait crossing), since those aren't
 * walkable trail and were never fabricated as geometry in the first place.
 */
export function findNearestPointOnLine(shape: TrailGeometryShape, position: LonLat): NearestPointResult {
  const line = toTurfLine(shape);
  const pt = point([position.longitude, position.latitude]);
  const result = nearestPointOnLine(line, pt, { units: 'kilometers' });

  return {
    distanceFromLineMeters: (result.properties.dist ?? 0) * 1000,
    distanceAlongLineKm: result.properties.location ?? 0,
    nearestCoordinate: result.geometry.coordinates as [number, number],
  };
}

/** [west, south, east, north], the shape MapLibre's Camera `bounds` prop expects. */
export type LngLatBounds = [number, number, number, number];

/** The geometry's first coordinate — used as a stable "trail start" camera target before GPS arrives. */
export function firstCoordinateOf(shape: TrailGeometryShape): [number, number] {
  return shape.type === 'MultiLineString' ? shape.coordinates[0][0] : shape.coordinates[0];
}

export function boundingBoxOf(shape: TrailGeometryShape): LngLatBounds {
  const flatCoordinates = shape.type === 'MultiLineString' ? shape.coordinates.flat() : shape.coordinates;

  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  for (const [lon, lat] of flatCoordinates) {
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }

  return [west, south, east, north];
}
