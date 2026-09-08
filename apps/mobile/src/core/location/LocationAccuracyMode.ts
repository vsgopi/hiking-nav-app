/**
 * Only HighAccuracy is wired up to real behavior in this milestone.
 * Balanced/BatterySaving are typed now so the battery strategy from the
 * product spec (§21) can be implemented later without changing this contract.
 */
export enum LocationAccuracyMode {
  HighAccuracy = 'high_accuracy',
  Balanced = 'balanced',
  BatterySaving = 'battery_saving',
}

export const DEFAULT_LOCATION_ACCURACY_MODE = LocationAccuracyMode.HighAccuracy;
