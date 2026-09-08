export interface GeoLineString {
  type: 'LineString';
  coordinates: [number, number][];
}

/**
 * Used for the whole-trail geometry: Te Araroa is not one physically continuous
 * line (e.g. the Cook Strait crossing between the North and South Island has no
 * walkable connection), so its regions are stored as separate parts rather than
 * joined by a fabricated connecting segment.
 */
export interface GeoMultiLineString {
  type: 'MultiLineString';
  coordinates: [number, number][][];
}

export type TrailGeometryShape = GeoLineString | GeoMultiLineString;

/**
 * sectionId is null for the whole-trail convenience row (used by
 * NavigationEngine for projection/progress). There is no `kind` field here —
 * whether a geometry is a main or bypass line is a property of the Section it
 * belongs to (sections.kind), not of the geometry itself; repository methods
 * that fetch bypass geometry (getBypassGeometries) already filter by the
 * owning section's kind at query time.
 */
export interface Geometry {
  id: number;
  sectionId: string | null;
  geometry: TrailGeometryShape;
  sourceId: string;
  sourceVersion: string | null;
  importedAt: string | null;
}
