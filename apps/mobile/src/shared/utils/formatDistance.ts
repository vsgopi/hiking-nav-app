/** Formats a distance-from-trail measurement for display: "42m" or "11.4km". */
export function formatDistanceFromTrail(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  return `${(meters / 1000).toFixed(1)}km`;
}
