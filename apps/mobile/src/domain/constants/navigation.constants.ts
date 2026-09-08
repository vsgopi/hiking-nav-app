/** A hiker farther than this from the trail geometry is considered off-trail. */
export const OFF_TRAIL_THRESHOLD_METERS = 50;

/**
 * Beyond this, a GPS fix isn't just "off trail" (a hiker who wandered off the
 * path) — it's nowhere near this trail at all (e.g. a simulator's default
 * location on the other side of the world, or a phone still at home before
 * the hike starts). Past this point:
 *  - the camera stops trying to follow the user and shows the trail itself
 *    at a useful overview scale instead (CameraController's `userOffTrail`
 *    mode), and
 *  - the UI shows a neutral "you're N km from this trail" state rather than
 *    an alarming, meaningless off-trail distance.
 * Below this threshold the camera keeps following the user even while
 * OffTrailBadge is showing (a hiker who wandered 200m off the path still
 * wants to see their own live position, not a static trail overview).
 */
export const TRAIL_RELEVANCE_THRESHOLD_METERS = 5000;
