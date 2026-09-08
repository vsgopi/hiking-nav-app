import type { LngLatBounds } from '../../shared/utils/geo';

/**
 * Explicit camera intents, kept separate from MapLibre's own prop shape so
 * this stays plain and unit-testable (see useCameraController.ts for the
 * stateful layer that adds manual-pan and button overrides on top of these).
 * Consumed by MapScreen.tsx, which renders the matching `<Camera>` props per
 * mode (MapLibre's own CameraProps type is a discriminated union that doesn't
 * spread cleanly from a single merged object, so the mode->props mapping
 * lives at the JSX call site).
 *
 * Four modes, matching the four camera states a hiking nav screen needs:
 *  - `initialTrailView`: no GPS fix yet. Centers on the trail's own start
 *    coordinate at hiking zoom — NOT the trail's full bounding box — so the
 *    very first frame already reads as "a trail to walk", not a country map.
 *  - `followUser`: the default once GPS is available and relevant. Centers
 *    on the live position at hiking zoom.
 *  - `overview`: the trail's complete bounds. Only entered by explicit user
 *    request (the "Overview" button) — never the automatic default.
 *  - `userOffTrail`: GPS is far enough from the trail that following it would
 *    just chase the camera off into unrelated space. Falls back to the trail
 *    bounds (same shape as `overview`, so it renders identically) rather than
 *    the user's own irrelevant position.
 */
export type CameraMode =
  | { kind: 'initialTrailView'; center: [number, number] }
  | { kind: 'followUser'; center: [number, number] }
  | { kind: 'overview'; bounds: LngLatBounds }
  | { kind: 'userOffTrail'; bounds: LngLatBounds };

export const TRAIL_BOUNDS_PADDING = { left: 40, right: 40, top: 80, bottom: 80 };
export const USER_CENTER_PADDING = { left: 0, right: 0, top: 0, bottom: 0 };

/**
 * Zoom level for `initialTrailView` and `followUser`: close enough to read as
 * hiking navigation (the next bend of trail, not the whole region). Deliberately
 * tighter than a "fit the trail" overview zoom, which varies per trail anyway.
 */
export const HIKING_ZOOM = 15;
export const CAMERA_MOVE_DURATION_MS = 800;

export interface ResolveCameraModeParams {
  /** Live GPS position, or null before the first fix arrives. */
  position: [number, number] | null;
  /** Perpendicular distance from the trail geometry, or null with no position yet. */
  distanceFromTrailMeters: number | null;
  /** The trail's own starting coordinate — the `initialTrailView` target. */
  trailStart: [number, number];
  /** The trail's bounding box — the `overview` / `userOffTrail` target. */
  trailBounds: LngLatBounds;
  /** Beyond this, GPS is irrelevant to this trail; see navigation.constants.ts. */
  irrelevantThresholdMeters: number;
}

/**
 * Pure derivation of the *automatic* camera mode from trail + GPS state alone
 * — no manual pan/button overrides here, see useCameraController.ts for those.
 */
export function resolveAutomaticCameraMode(params: ResolveCameraModeParams): CameraMode {
  const { position, distanceFromTrailMeters, trailStart, trailBounds, irrelevantThresholdMeters } = params;

  if (!position) {
    return { kind: 'initialTrailView', center: trailStart };
  }
  if (distanceFromTrailMeters !== null && distanceFromTrailMeters > irrelevantThresholdMeters) {
    return { kind: 'userOffTrail', bounds: trailBounds };
  }
  return { kind: 'followUser', center: position };
}
