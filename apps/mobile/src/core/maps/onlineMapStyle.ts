/**
 * OpenFreeMap's hosted Positron style: free, keyless, no rate limits
 * (donation-funded), and deliberately minimal — light gray landcover, thin
 * unlabelled-by-default road lines, no contour lines, no terrain shading, no
 * building fills. This app is trail-first: the basemap's job is to give quiet
 * geographic context (where the coastline/city is), not to compete with the
 * trail line and GPS marker for attention. A topographic style (contours,
 * terrain shading, dense POI/road labels) reads as a GIS viewer and buries
 * the trail as "just another layer" — the opposite of what a hiking
 * navigation screen needs.
 *
 * Previously this pointed at CARTO's basemaps.cartocdn.com raster endpoint,
 * which was free/keyless at the time but has since started requiring an
 * account/API key — requests without one now return a tile that reads
 * "API KEY REQUIRED" instead of map data.
 * https://openfreemap.org
 */
export const onlineMapStyle = 'https://tiles.openfreemap.org/styles/positron';
