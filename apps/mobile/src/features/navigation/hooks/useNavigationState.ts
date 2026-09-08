import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppServices } from '../../../app/providers/AppProviders';
import { LocationAccuracyMode } from '../../../core/location/LocationAccuracyMode';
import { logger } from '../../../core/logging/logger';
import { keyValueStore } from '../../../core/storage/keyValueStore';
import { computeNavigationState } from '../../../domain/usecases/NavigationEngine';
import type { GeoPosition } from '../../../domain/usecases/NavigationEngine.types';
import type { TrailDataState } from '../../trail/hooks/useTrailGeometry';

const LAST_POSITION_KEY = 'lastKnownPosition';

export interface NavigationHookState {
  position: GeoPosition | null;
  isOffTrail: boolean;
  completionPercentage: number;
  distanceAlongTrailKm: number;
  distanceRemainingKm: number;
  distanceFromTrailMeters: number;
  currentSectionId: string | null;
}

const INITIAL_STATE: Omit<NavigationHookState, 'position' | 'currentSectionId'> = {
  isOffTrail: false,
  completionPercentage: 0,
  distanceAlongTrailKm: 0,
  distanceRemainingKm: 0,
  distanceFromTrailMeters: 0,
};

/**
 * The trail this screen shows before/without a GPS fix defaults to the first
 * main section by official_number, so the map always has a definite section
 * to display (bounds + highlighted line) instead of showing nothing until
 * GPS resolves which section the hiker is in. Bypass sections are excluded —
 * see resolveCurrentSection in NavigationEngine.ts for why.
 */
function firstSectionId(trailData: Extract<TrailDataState, { status: 'ready' }> | null): string | null {
  if (!trailData) return null;
  const mainSections = trailData.sections.filter((s) => s.kind === 'main');
  if (mainSections.length === 0) return null;
  return [...mainSections].sort((a, b) => (a.officialNumber ?? 0) - (b.officialNumber ?? 0))[0].id;
}

function readCachedPosition(): GeoPosition | null {
  const cached = keyValueStore.getString(LAST_POSITION_KEY);
  if (!cached) return null;
  try {
    return JSON.parse(cached) as GeoPosition;
  } catch {
    return null;
  }
}

export function useNavigationState(
  trailData: Extract<TrailDataState, { status: 'ready' }> | null,
): NavigationHookState {
  const { locationService } = useAppServices();
  const [position, setPosition] = useState<GeoPosition | null>(() => readCachedPosition());
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      const permission = await locationService.requestPermission();
      if (permission !== 'granted') {
        logger.warn('Location permission not granted; navigation state will not update.');
        return;
      }

      const unsubscribe = await locationService.subscribeToPosition(
        LocationAccuracyMode.HighAccuracy,
        (fix) => {
          if (cancelled) return;
          const nextPosition: GeoPosition = { latitude: fix.latitude, longitude: fix.longitude };
          keyValueStore.setString(LAST_POSITION_KEY, JSON.stringify(nextPosition));
          setPosition(nextPosition);
        },
        (error) => {
          logger.error('Location subscription error', error);
        },
      );

      if (cancelled) {
        unsubscribe();
      } else {
        unsubscribeRef.current = unsubscribe;
      }
    }

    start();

    return () => {
      cancelled = true;
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
    };
  }, [locationService]);

  // Derived from the latest position + trailData on every render, rather than
  // mirrored into state from multiple effects — avoids the race where a GPS
  // fix arrives before trailData finishes loading from SQLite and never gets
  // recomputed once it does.
  return useMemo<NavigationHookState>(() => {
    if (!position) {
      return { position: null, currentSectionId: firstSectionId(trailData), ...INITIAL_STATE };
    }
    if (!trailData || !trailData.geometry) {
      // No whole-trail geometry ingested yet (or not license-cleared for this
      // build) — nothing to project the GPS fix onto, so fall back to the
      // same "no trail data" shape rather than a fabricated navigation state.
      return { position, currentSectionId: firstSectionId(trailData), ...INITIAL_STATE };
    }
    const navState = computeNavigationState(
      position,
      trailData.trail.distanceKm,
      trailData.geometry,
      trailData.sections,
    );
    return { position, ...navState };
  }, [position, trailData]);
}
