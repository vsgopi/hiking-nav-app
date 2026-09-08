import { findNearestPointOnLine } from '../../shared/utils/geo';
import { OFF_TRAIL_THRESHOLD_METERS } from '../constants/navigation.constants';
import type { TrailGeometryShape } from '../models/TrailGeometry';
import type { Section } from '../models/Section';
import type { GeoPosition, NavigationState, SectionProgress } from './NavigationEngine.types';

export function projectPositionOntoTrail(position: GeoPosition, geometry: TrailGeometryShape) {
  return findNearestPointOnLine(geometry, {
    longitude: position.longitude,
    latitude: position.latitude,
  });
}

export function isOffTrail(
  distanceFromTrailMeters: number,
  thresholdMeters: number = OFF_TRAIL_THRESHOLD_METERS,
): boolean {
  return distanceFromTrailMeters > thresholdMeters;
}

/**
 * Only `kind === 'main'` sections advance the cumulative-distance sum —
 * bypass sections run parallel to a main section's own distance range, not
 * after it, so including them would double-count distance and corrupt the
 * whole-trail progress calculation. Sections with a redacted/unknown kind
 * (license-gated, or not yet ingested) are excluded rather than guessed at.
 *
 * Sorted by officialNumber (the Trust's own north-to-south ordering) rather
 * than a separate sequence field — official_number already carries that
 * order, so a redundant field isn't stored.
 */
export function resolveCurrentSection(distanceAlongTrailKm: number, sections: Section[]): Section | null {
  const mainSections = sections.filter((s) => s.kind === 'main');
  if (mainSections.length === 0) return null;

  const sorted = [...mainSections].sort((a, b) => (a.officialNumber ?? 0) - (b.officialNumber ?? 0));
  let cumulativeKm = 0;
  for (const section of sorted) {
    cumulativeKm += section.distanceKm ?? 0;
    if (distanceAlongTrailKm <= cumulativeKm) {
      return section;
    }
  }
  return sorted[sorted.length - 1];
}

export function computeCompletionPercentage(
  distanceAlongTrailKm: number,
  totalDistanceKm: number,
): number {
  if (totalDistanceKm <= 0) return 0;
  const pct = (distanceAlongTrailKm / totalDistanceKm) * 100;
  return Math.min(100, Math.max(0, pct));
}

/**
 * Progress scoped to the section the hiker is actually walking (e.g. the
 * ~12km "Northern Walkway" leg), rather than the whole multi-region trail's
 * total distance. This is what the on-screen progress bar shows: "1.7 / 12.7
 * km" only makes sense against the section you're on, not a thousand-km
 * thru-hike total. Projects onto the section's OWN geometry (not the whole
 * trail's), so `distanceAlongSectionKm` is local to that section.
 *
 * Because this always reports the nearest point along the line regardless of
 * how far off it the hiker has wandered, a detour doesn't spuriously advance
 * progress — it just holds at the nearest point on the section until the
 * hiker actually walks further along it.
 */
export function computeSectionRelativeProgress(
  position: GeoPosition,
  sectionGeometry: TrailGeometryShape,
  sectionDistanceKm: number,
): SectionProgress {
  const projection = findNearestPointOnLine(sectionGeometry, {
    longitude: position.longitude,
    latitude: position.latitude,
  });
  const distanceAlongSectionKm = Math.min(projection.distanceAlongLineKm, sectionDistanceKm);
  const completionPercentage = computeCompletionPercentage(distanceAlongSectionKm, sectionDistanceKm);
  const distanceRemainingKm = Math.max(0, sectionDistanceKm - distanceAlongSectionKm);

  return { distanceAlongSectionKm, distanceRemainingKm, completionPercentage };
}

export function computeNavigationState(
  position: GeoPosition,
  totalDistanceKm: number,
  geometry: TrailGeometryShape,
  sections: Section[],
): NavigationState {
  const projection = projectPositionOntoTrail(position, geometry);
  const distanceAlongTrailKm = projection.distanceAlongLineKm;
  const distanceFromTrailMeters = projection.distanceFromLineMeters;
  const currentSection = resolveCurrentSection(distanceAlongTrailKm, sections);
  const completionPercentage = computeCompletionPercentage(distanceAlongTrailKm, totalDistanceKm);
  const distanceRemainingKm = Math.max(0, totalDistanceKm - distanceAlongTrailKm);

  return {
    currentSectionId: currentSection?.id ?? null,
    distanceAlongTrailKm,
    distanceRemainingKm,
    completionPercentage,
    distanceFromTrailMeters,
    isOffTrail: isOffTrail(distanceFromTrailMeters),
  };
}
