import { Camera, GeoJSONSource, Layer, Map as MapLibreMap, Marker } from '@maplibre/maplibre-react-native';
import type { StyleSpecification, ViewStateChangeEvent } from '@maplibre/maplibre-react-native';

/**
 * Screens/features should import map primitives from here, never directly
 * from @maplibre/maplibre-react-native, so the rendering engine can be
 * swapped later without touching feature code.
 */
export const MapView = MapLibreMap;
export { Camera, GeoJSONSource, Layer, Marker };
export type { StyleSpecification, ViewStateChangeEvent };
