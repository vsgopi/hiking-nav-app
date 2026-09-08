import { useCallback, useMemo, useState } from 'react';
import type { NativeSyntheticEvent } from 'react-native';
import type { ViewStateChangeEvent } from './MapProvider';
import { resolveAutomaticCameraMode, type CameraMode, type ResolveCameraModeParams } from './CameraController';

export interface CameraController {
  cameraMode: CameraMode;
  /** False once the user has manually panned/zoomed — shows the "Re-center" button. */
  isFollowing: boolean;
  isOverviewActive: boolean;
  isShowingActualLocation: boolean;
  /** Wire to <MapView onRegionDidChange>. */
  onRegionDidChange: (event: NativeSyntheticEvent<ViewStateChangeEvent>) => void;
  /** "Overview" button: intentionally fit the complete trail bounds. */
  requestOverview: () => void;
  /** "Re-center" button: resume automatic follow/initial-view behavior. */
  requestRecenter: () => void;
  /** "Show my location" button: jump to the actual GPS fix even if it's far from the trail. */
  toggleShowActualLocation: () => void;
}

/**
 * Layers the interactive parts of hiking-nav camera behavior on top of the
 * pure `resolveAutomaticCameraMode`:
 *  - a manual pan/zoom (gesture-driven `onRegionDidChange`, not one of our own
 *    programmatic camera moves) freezes the camera where the user left it and
 *    surfaces "Re-center", instead of snapping back on the next GPS update;
 *  - "Overview" and "Re-center" both resume driving the camera from state,
 *    clearing any manual freeze — Overview additionally pins it to the full
 *    trail bounds until Re-center is pressed;
 *  - "Show my location" is the off-trail escape hatch: jump to the real GPS
 *    fix even when it's outside the trail-relevance threshold, for a hiker
 *    who wants to confirm exactly where they are relative to the trail.
 */
export function useCameraController(params: ResolveCameraModeParams): CameraController {
  const [followEnabled, setFollowEnabled] = useState(true);
  const [overviewRequested, setOverviewRequested] = useState(false);
  const [showActualLocation, setShowActualLocation] = useState(false);
  const [frozenMode, setFrozenMode] = useState<CameraMode | null>(null);

  const automaticMode = resolveAutomaticCameraMode(params);

  const desiredMode: CameraMode = useMemo(() => {
    if (showActualLocation && params.position) {
      return { kind: 'followUser', center: params.position };
    }
    if (overviewRequested) {
      return { kind: 'overview', bounds: params.trailBounds };
    }
    return automaticMode;
  }, [showActualLocation, overviewRequested, automaticMode, params.position, params.trailBounds]);

  const onRegionDidChange = useCallback(
    (event: NativeSyntheticEvent<ViewStateChangeEvent>) => {
      if (!event.nativeEvent.userInteraction) return; // one of our own programmatic camera moves
      setFollowEnabled((wasFollowing) => {
        if (wasFollowing) {
          setFrozenMode(desiredMode);
        }
        return false;
      });
    },
    [desiredMode],
  );

  const requestOverview = useCallback(() => {
    setShowActualLocation(false);
    setOverviewRequested(true);
    setFrozenMode(null);
    setFollowEnabled(true);
  }, []);

  const requestRecenter = useCallback(() => {
    setShowActualLocation(false);
    setOverviewRequested(false);
    setFrozenMode(null);
    setFollowEnabled(true);
  }, []);

  const toggleShowActualLocation = useCallback(() => {
    setOverviewRequested(false);
    setFrozenMode(null);
    setFollowEnabled(true);
    setShowActualLocation((wasShowing) => !wasShowing);
  }, []);

  return {
    cameraMode: followEnabled ? desiredMode : (frozenMode ?? desiredMode),
    isFollowing: followEnabled,
    isOverviewActive: overviewRequested,
    isShowingActualLocation: showActualLocation,
    onRegionDidChange,
    requestOverview,
    requestRecenter,
    toggleShowActualLocation,
  };
}
