export interface UserProgress {
  trailId: string;
  currentLatitude: number;
  currentLongitude: number;
  trailDistanceKm: number;
  currentSectionId: string | null;
  completionPercentage: number;
  updatedAt: string;
}
