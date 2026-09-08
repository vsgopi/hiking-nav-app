export interface GeoPosition {
  latitude: number;
  longitude: number;
}

export interface NavigationState {
  currentSectionId: string | null;
  distanceAlongTrailKm: number;
  distanceRemainingKm: number;
  completionPercentage: number;
  distanceFromTrailMeters: number;
  isOffTrail: boolean;
}

/** Progress local to a single section's own geometry/distance — see computeSectionRelativeProgress. */
export interface SectionProgress {
  distanceAlongSectionKm: number;
  distanceRemainingKm: number;
  completionPercentage: number;
}
