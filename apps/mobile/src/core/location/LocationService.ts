import * as Location from 'expo-location';
import { logger } from '../logging/logger';
import { DEFAULT_LOCATION_ACCURACY_MODE, LocationAccuracyMode } from './LocationAccuracyMode';

export interface LocationFix {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  headingDegrees: number | null;
  timestamp: number;
}

export type LocationPermissionState = 'granted' | 'denied' | 'undetermined';

export interface LocationService {
  requestPermission(): Promise<LocationPermissionState>;
  getPermissionState(): Promise<LocationPermissionState>;
  getCurrentPosition(): Promise<LocationFix | null>;
  subscribeToPosition(
    mode: LocationAccuracyMode,
    onUpdate: (fix: LocationFix) => void,
    onError: (error: unknown) => void,
  ): Promise<() => void>;
}

function toPermissionState(status: Location.PermissionStatus): LocationPermissionState {
  if (status === Location.PermissionStatus.GRANTED) return 'granted';
  if (status === Location.PermissionStatus.DENIED) return 'denied';
  return 'undetermined';
}

function toFix(location: Location.LocationObject): LocationFix {
  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracyMeters: location.coords.accuracy,
    headingDegrees: location.coords.heading,
    timestamp: location.timestamp,
  };
}

function toAccuracy(mode: LocationAccuracyMode): Location.Accuracy {
  switch (mode) {
    case LocationAccuracyMode.HighAccuracy:
      return Location.Accuracy.BestForNavigation;
    case LocationAccuracyMode.Balanced:
      return Location.Accuracy.Balanced;
    case LocationAccuracyMode.BatterySaving:
      return Location.Accuracy.Low;
  }
}

class ExpoLocationService implements LocationService {
  async requestPermission(): Promise<LocationPermissionState> {
    const { status } = await Location.requestForegroundPermissionsAsync();
    return toPermissionState(status);
  }

  async getPermissionState(): Promise<LocationPermissionState> {
    const { status } = await Location.getForegroundPermissionsAsync();
    return toPermissionState(status);
  }

  async getCurrentPosition(): Promise<LocationFix | null> {
    const permission = await this.getPermissionState();
    if (permission !== 'granted') return null;

    const location = await Location.getCurrentPositionAsync({
      accuracy: toAccuracy(DEFAULT_LOCATION_ACCURACY_MODE),
    });
    return toFix(location);
  }

  async subscribeToPosition(
    mode: LocationAccuracyMode,
    onUpdate: (fix: LocationFix) => void,
    onError: (error: unknown) => void,
  ): Promise<() => void> {
    const permission = await this.getPermissionState();
    if (permission !== 'granted') {
      onError(new Error('Location permission not granted'));
      return () => {};
    }

    try {
      const subscription = await Location.watchPositionAsync(
        {
          accuracy: toAccuracy(mode),
          timeInterval: 2000,
          distanceInterval: 5,
        },
        (location) => onUpdate(toFix(location)),
      );
      return () => subscription.remove();
    } catch (error) {
      logger.error('Failed to start location subscription', error);
      onError(error);
      return () => {};
    }
  }
}

export const locationService: LocationService = new ExpoLocationService();
