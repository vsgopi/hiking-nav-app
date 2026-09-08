import type { StyleSpecification } from './MapProvider';

/**
 * A minimal local MapLibre style with no tile sources, so map initialization
 * makes zero network requests. Fallback for offline mode until the
 * Downloads-phase work (MBTiles/PMTiles basemap downloads) lands; not
 * currently wired into any screen.
 */
export const offlineMapStyle: StyleSpecification = {
  version: 8,
  name: 'Offline Minimal',
  sources: {},
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: {
        'background-color': '#eef2ec',
      },
    },
  ],
};
