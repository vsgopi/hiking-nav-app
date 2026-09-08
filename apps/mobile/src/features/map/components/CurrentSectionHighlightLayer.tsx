import React from 'react';
import { GeoJSONSource, Layer } from '../../../core/maps/MapProvider';
import type { TrailGeometryShape } from '../../../domain/models/TrailGeometry';

const CURRENT_SECTION_SOURCE_ID = 'currentSectionHighlightSource';

/**
 * The trail the hiker is actually walking — the visually dominant line on
 * screen. A wide, soft white casing underneath a bold, saturated core line
 * ("glow") keeps it legible over the basemap in both light and busy areas,
 * the way a hiking-navigation app renders a route rather than a GIS overlay.
 */
export function CurrentSectionHighlightLayer({ geometry }: { geometry: TrailGeometryShape | null }) {
  if (!geometry) return null;

  return (
    <GeoJSONSource id={CURRENT_SECTION_SOURCE_ID} data={geometry}>
      <Layer
        id="currentSectionGlow"
        type="line"
        source={CURRENT_SECTION_SOURCE_ID}
        paint={{ 'line-color': '#ffffff', 'line-width': 10, 'line-opacity': 0.85, 'line-blur': 1 }}
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
      />
      <Layer
        id="currentSectionHighlight"
        type="line"
        source={CURRENT_SECTION_SOURCE_ID}
        paint={{ 'line-color': '#e8542a', 'line-width': 6 }}
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
      />
    </GeoJSONSource>
  );
}
