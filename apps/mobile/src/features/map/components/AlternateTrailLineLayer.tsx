import React, { useMemo } from 'react';
import type { Feature, FeatureCollection, LineString, MultiLineString } from 'geojson';
import { GeoJSONSource, Layer } from '../../../core/maps/MapProvider';
import type { TrailGeometryShape } from '../../../domain/models/TrailGeometry';

const ALTERNATE_SOURCE_ID = 'alternateTrailLineSource';

/** Bypass routes: visually distinct (dashed, thinner, amber) from the main line. */
export function AlternateTrailLineLayer({ geometries }: { geometries: TrailGeometryShape[] }) {
  const collection = useMemo<FeatureCollection<LineString | MultiLineString>>(
    () => ({
      type: 'FeatureCollection',
      features: geometries.map(
        (g): Feature<LineString | MultiLineString> => ({
          type: 'Feature',
          properties: {},
          geometry: g,
        }),
      ),
    }),
    [geometries],
  );

  if (geometries.length === 0) return null;

  return (
    <GeoJSONSource id={ALTERNATE_SOURCE_ID} data={collection}>
      <Layer
        id="alternateTrailLine"
        type="line"
        source={ALTERNATE_SOURCE_ID}
        paint={{ 'line-color': '#e0a03c', 'line-width': 2.5, 'line-dasharray': [2, 2] }}
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
      />
    </GeoJSONSource>
  );
}
