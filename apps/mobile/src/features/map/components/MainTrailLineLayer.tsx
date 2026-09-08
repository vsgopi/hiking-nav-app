import React from 'react';
import { GeoJSONSource, Layer } from '../../../core/maps/MapProvider';
import type { TrailGeometryShape } from '../../../domain/models/TrailGeometry';

const TRAIL_SOURCE_ID = 'mainTrailLineSource';

/**
 * The whole multi-region trail as quiet background context — thin and muted,
 * so it reads as "the route continues this way" beyond the current section
 * without competing with CurrentSectionHighlightLayer, which is the bold line
 * hikers actually look at.
 */
export function MainTrailLineLayer({ geometry }: { geometry: TrailGeometryShape }) {
  return (
    <GeoJSONSource id={TRAIL_SOURCE_ID} data={geometry}>
      <Layer
        id="mainTrailLine"
        type="line"
        source={TRAIL_SOURCE_ID}
        paint={{ 'line-color': '#8a94a3', 'line-width': 2, 'line-opacity': 0.6 }}
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
      />
    </GeoJSONSource>
  );
}
