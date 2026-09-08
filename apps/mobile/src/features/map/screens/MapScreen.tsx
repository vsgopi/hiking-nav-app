import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Camera, MapView } from '../../../core/maps/MapProvider';
import {
  CAMERA_MOVE_DURATION_MS,
  HIKING_ZOOM,
  TRAIL_BOUNDS_PADDING,
  USER_CENTER_PADDING,
} from '../../../core/maps/CameraController';
import { useCameraController } from '../../../core/maps/useCameraController';
import { onlineMapStyle } from '../../../core/maps/onlineMapStyle';
import { TRAIL_RELEVANCE_THRESHOLD_METERS } from '../../../domain/constants/navigation.constants';
import { computeSectionRelativeProgress } from '../../../domain/usecases/NavigationEngine';
import { ErrorView } from '../../../shared/components/ErrorView';
import { LoadingView } from '../../../shared/components/LoadingView';
import { boundingBoxOf, firstCoordinateOf, type LngLatBounds } from '../../../shared/utils/geo';
import { MapActionButton } from '../components/MapActionButton';
import { OffTrailBadge } from '../../navigation/components/OffTrailBadge';
import { ProgressBar } from '../../navigation/components/ProgressBar';
import { TrailOverviewBadge } from '../../navigation/components/TrailOverviewBadge';
import { useNavigationState } from '../../navigation/hooks/useNavigationState';
import { TrailInfoPanel } from '../../trail/components/TrailInfoPanel';
import { useCurrentSectionGeometry } from '../../trail/hooks/useCurrentSectionGeometry';
import { useTrailGeometry } from '../../trail/hooks/useTrailGeometry';
import { AlternateTrailLineLayer } from '../components/AlternateTrailLineLayer';
import { CurrentSectionHighlightLayer } from '../components/CurrentSectionHighlightLayer';
import { MainTrailLineLayer } from '../components/MainTrailLineLayer';
import { UserLocationMarker } from '../components/UserLocationMarker';

export function MapScreen() {
  const trailData = useTrailGeometry();
  const navigationState = useNavigationState(trailData.status === 'ready' ? trailData : null);
  const currentSectionGeometry = useCurrentSectionGeometry(
    trailData.status === 'ready' ? navigationState.currentSectionId : null,
  );

  // "The trail" this screen is about is the section the hiker is actually
  // walking (e.g. a single ~10km leg), not the whole multi-region journey —
  // its geometry drives the camera bounds/start and the progress numbers.
  // The whole-trail geometry is used only as a fallback for the very first
  // render, before the current-section geometry has loaded. All of this is
  // computed before the loading/error early returns below (rather than
  // after, as with the old plain-function camera calc) because
  // useCameraController is a real hook and must run on every render.
  const currentSection =
    trailData.status === 'ready'
      ? (trailData.sections.find((s) => s.id === navigationState.currentSectionId) ?? null)
      : null;
  const activeGeometry =
    trailData.status === 'ready' ? (currentSectionGeometry ?? trailData.geometry) : null;
  const trailBounds: LngLatBounds = activeGeometry ? boundingBoxOf(activeGeometry) : [0, 0, 0, 0];
  const trailStart: [number, number] = activeGeometry ? firstCoordinateOf(activeGeometry) : [0, 0];
  // Falls back to the trail's own name whenever the current section's official
  // name is unavailable — either not ingested yet, or redacted by the
  // production license gate while its source is Trust-pending.
  const trailName = trailData.status === 'ready' ? (currentSection?.officialName ?? trailData.trail.name) : '';

  const userCenter: [number, number] | null = navigationState.position
    ? [navigationState.position.longitude, navigationState.position.latitude]
    : null;

  const cameraController = useCameraController({
    position: userCenter,
    distanceFromTrailMeters: navigationState.position ? navigationState.distanceFromTrailMeters : null,
    trailStart,
    trailBounds,
    irrelevantThresholdMeters: TRAIL_RELEVANCE_THRESHOLD_METERS,
  });
  const { cameraMode } = cameraController;

  if (trailData.status === 'loading') {
    return <LoadingView label="Loading trail…" />;
  }

  if (trailData.status === 'error') {
    return <ErrorView message="Could not load trail data" detail={trailData.errorMessage} />;
  }

  const { geometry, bypassGeometries } = trailData;

  const isOffTrailFar =
    navigationState.isOffTrail && navigationState.distanceFromTrailMeters > TRAIL_RELEVANCE_THRESHOLD_METERS;
  const isOffTrailNearby = navigationState.isOffTrail && !isOffTrailFar;
  const showRecenter =
    !cameraController.isFollowing || cameraController.isOverviewActive || cameraController.isShowingActualLocation;

  // currentSection.distanceKm is null until section geometry is ingested (or
  // while license-gated) — falls back to 0 rather than fabricating a distance.
  const sectionProgress =
    navigationState.position && currentSectionGeometry && currentSection?.distanceKm != null
      ? computeSectionRelativeProgress(navigationState.position, currentSectionGeometry, currentSection.distanceKm)
      : {
          distanceAlongSectionKm: 0,
          distanceRemainingKm: currentSection?.distanceKm ?? 0,
          completionPercentage: 0,
        };

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        mapStyle={onlineMapStyle}
        logo={false}
        attribution={true}
        onRegionDidChange={cameraController.onRegionDidChange}
      >
        {cameraMode.kind === 'overview' || cameraMode.kind === 'userOffTrail' ? (
          <Camera
            bounds={cameraMode.bounds}
            padding={TRAIL_BOUNDS_PADDING}
            duration={CAMERA_MOVE_DURATION_MS}
            easing="fly"
          />
        ) : (
          <Camera
            center={cameraMode.center}
            zoom={HIKING_ZOOM}
            padding={USER_CENTER_PADDING}
            duration={CAMERA_MOVE_DURATION_MS}
            easing="fly"
          />
        )}
        {geometry && <MainTrailLineLayer geometry={geometry} />}
        <AlternateTrailLineLayer geometries={bypassGeometries} />
        <CurrentSectionHighlightLayer geometry={currentSectionGeometry} />
        {navigationState.position && (
          <UserLocationMarker position={navigationState.position} isOffTrail={navigationState.isOffTrail} />
        )}
      </MapView>

      <View style={styles.overlayTop} pointerEvents="box-none">
        <View style={styles.topRow} pointerEvents="box-none">
          <TrailInfoPanel title={trailName} subtitle={trailData.trail.name} />
          <MapActionButton label="Overview" onPress={cameraController.requestOverview} />
        </View>
        {isOffTrailNearby && (
          <OffTrailBadge distanceMeters={navigationState.distanceFromTrailMeters} trailName={trailName} />
        )}
        {isOffTrailFar && (
          <TrailOverviewBadge
            distanceMeters={navigationState.distanceFromTrailMeters}
            trailName={trailName}
            isShowingActualLocation={cameraController.isShowingActualLocation}
            onToggleShowActualLocation={cameraController.toggleShowActualLocation}
          />
        )}
      </View>

      {showRecenter && (
        <View style={styles.recenter} pointerEvents="box-none">
          <MapActionButton label="Re-center" onPress={cameraController.requestRecenter} variant="primary" />
        </View>
      )}

      <View style={styles.overlayBottom} pointerEvents="box-none">
        <ProgressBar
          completionPercentage={sectionProgress.completionPercentage}
          distanceAlongTrailKm={sectionProgress.distanceAlongSectionKm}
          distanceRemainingKm={sectionProgress.distanceRemainingKm}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  overlayTop: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  recenter: {
    position: 'absolute',
    right: 16,
    bottom: 100,
  },
  overlayBottom: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
  },
});
