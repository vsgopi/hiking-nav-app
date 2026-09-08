import type { TravelMode } from '../../src/domain/models/Section';
import type { MainDisposition } from './types';

/**
 * Pure classification of whether a main section should even be attempted
 * against OSM this run, and if not, why — extracted so these rules (Phase
 * 2.1 Priorities 3 and 7) are independently testable without a live
 * Overpass/Trust fetch.
 */
export type PreflightResult = { attempt: true } | { attempt: false; disposition: MainDisposition; errors: string[] };

export function classifyMainSectionPreflight(
  travelMode: TravelMode | null,
  sectionRegionIds: string[],
  failedCanonicalRegionIds: ReadonlySet<string>,
): PreflightResult {
  if (travelMode === 'ferry' || travelMode === 'water_taxi') {
    return { attempt: false, disposition: 'expected_no_geometry_due_to_travel_mode', errors: [] };
  }
  const failedRegions = sectionRegionIds.filter((r) => failedCanonicalRegionIds.has(r));
  if (failedRegions.length > 0) {
    return {
      attempt: false,
      disposition: 'source_region_failed',
      errors: [`section's own region (${failedRegions.join(', ')}) failed OSM regional validation this run`],
    };
  }
  return { attempt: true };
}
