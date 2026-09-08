import { resolveAutomaticCameraMode, type ResolveCameraModeParams } from '../CameraController';
import type { LngLatBounds } from '../../../shared/utils/geo';

const trailBounds: LngLatBounds = [174.7, -41.3, 174.8, -41.2];
const trailStart: [number, number] = [174.75, -41.3];
const irrelevantThresholdMeters = 5000;

const baseParams: ResolveCameraModeParams = {
  position: null,
  distanceFromTrailMeters: null,
  trailStart,
  trailBounds,
  irrelevantThresholdMeters,
};

describe('resolveAutomaticCameraMode', () => {
  it('shows the trail start (not the trail bounds) before any GPS fix arrives', () => {
    const mode = resolveAutomaticCameraMode(baseParams);
    expect(mode).toEqual({ kind: 'initialTrailView', center: trailStart });
  });

  it('follows the user once GPS is within the relevance threshold', () => {
    const position: [number, number] = [174.75, -41.25];
    const mode = resolveAutomaticCameraMode({ ...baseParams, position, distanceFromTrailMeters: 30 });
    expect(mode).toEqual({ kind: 'followUser', center: position });
  });

  it('keeps following a user who has wandered moderately off-trail', () => {
    const position: [number, number] = [174.755, -41.252];
    const mode = resolveAutomaticCameraMode({ ...baseParams, position, distanceFromTrailMeters: 200 });
    expect(mode).toEqual({ kind: 'followUser', center: position });
  });

  it('falls back to the trail bounds when the position is far beyond the threshold', () => {
    const position: [number, number] = [-122.03, 37.33]; // e.g. a simulator default location
    const mode = resolveAutomaticCameraMode({
      ...baseParams,
      position,
      distanceFromTrailMeters: 11_421_483,
    });
    expect(mode).toEqual({ kind: 'userOffTrail', bounds: trailBounds });
  });
});
