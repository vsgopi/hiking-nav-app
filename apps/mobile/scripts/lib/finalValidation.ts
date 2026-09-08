import { lineStringLengthKm } from '../../src/shared/utils/geo';
import type { SlicedGeometry } from './sectionSlicing';

/** Reuses the app's own length function — same shape ({type, coordinates}), same turf-based implementation used everywhere else in this codebase, so a section's stored length is computed identically to how the app itself would compute it. */
export function computeLengthKm(geometry: SlicedGeometry): number {
  return lineStringLengthKm(geometry);
}

export type LengthPlausibility = { status: 'ok' | 'warn' | 'fail'; diffPct: number };

const LENGTH_WARN_TOLERANCE = 0.15;
const LENGTH_FAIL_TOLERANCE = 0.4;

/**
 * Flag-only — never used to reject or auto-correct otherwise-valid OSM
 * geometry. A large discrepancy against the Trust's published distance is a
 * finding to report (the earlier data audit already found several of these
 * in the Trust's own data), not something to reconcile away.
 */
export function checkLengthPlausibility(computedKm: number, officialDistanceKm: number | null): LengthPlausibility | null {
  if (officialDistanceKm === null || officialDistanceKm <= 0) return null;
  const diffPct = Math.abs(computedKm - officialDistanceKm) / officialDistanceKm;
  if (diffPct > LENGTH_FAIL_TOLERANCE) return { status: 'fail', diffPct };
  if (diffPct > LENGTH_WARN_TOLERANCE) return { status: 'warn', diffPct };
  return { status: 'ok', diffPct };
}

export function geometryPointCount(geometry: SlicedGeometry): number {
  return geometry.type === 'LineString'
    ? geometry.coordinates.length
    : geometry.coordinates.reduce((sum, part) => sum + part.length, 0);
}
