import nearestPointOnLine from '@turf/nearest-point-on-line';
import length from '@turf/length';
import { lineString, point } from '@turf/helpers';
import type { Coord, Part } from './types';

export function haversineMeters(a: Coord, b: Coord): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function partLengthKm(part: Part): number {
  if (part.length < 2) return 0;
  return length(lineString(part), { units: 'kilometers' });
}

export interface PartNearestMatch {
  segmentIndex: number;
  coordinate: Coord;
  distanceMeters: number;
  /** Distance along this one part, from its own start, in km. */
  distanceAlongPartKm: number;
}

/**
 * Nearest point on a single Part (turf's nearestPointOnLine only accepts one
 * LineString at a time — multi-part search is handled one level up, by
 * calling this per part and picking the best result. Never call this with a
 * degenerate part (<2 points).
 */
export function nearestPointOnPart(part: Part, target: Coord): PartNearestMatch {
  const result = nearestPointOnLine(lineString(part), point(target), { units: 'kilometers' });
  return {
    segmentIndex: result.properties.index ?? 0,
    coordinate: result.geometry.coordinates as Coord,
    distanceMeters: (result.properties.dist ?? 0) * 1000,
    distanceAlongPartKm: result.properties.location ?? 0,
  };
}
