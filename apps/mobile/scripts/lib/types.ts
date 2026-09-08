/**
 * Shared types for the Phase 2 section-geometry ingestion pipeline
 * (Trust-GPX-anchored, OSM-only stored geometry). Pure data shapes only — no
 * network/filesystem code lives in this file, so every consumer of these
 * types is independently unit-testable.
 */

export type Coord = [number, number]; // [lon, lat] — matches GeoJSON/this app's convention throughout

/** One continuous, gap-free coordinate run. A region or island "line" is an ordered array of these. */
export type Part = Coord[];

export type Island = 'NI' | 'SI';

/**
 * The whole-island main route, assembled by concatenating each region's own
 * stitched parts in region.sequence order (never stitched across regions —
 * see islandAssembly.ts). `partRegionIds[i]` names which region contributed
 * `parts[i]`, purely for provenance reporting; it is never used to restrict
 * where a boundary may be matched (see boundaryMatching.ts for why).
 */
export interface IslandLine {
  island: Island;
  parts: Part[];
  partRegionIds: string[];
}

/** One candidate OSM alternate/bypass relation, kept independent — never concatenated with any other candidate or with a main IslandLine. */
export interface BypassCandidate {
  id: string;
  name: string;
  parts: Part[];
}

export type BoundaryRole = 'start' | 'end';

/** The exact result of cutting a line at one point: which part, which segment within that part, and the exact interpolated coordinate. */
export interface ResolvedCut {
  partIndex: number;
  /** The cut point lies on the segment between parts[partIndex][segmentIndex] and parts[partIndex][segmentIndex + 1]. */
  segmentIndex: number;
  coordinate: Coord;
}

/**
 * `matched` requires BOTH a within-threshold, correctly-ordered slice AND a
 * length consistent with official_distance_km (within warn tolerance) AND no
 * interval overlap with another section — see matchConfidence.ts. A
 * technically-valid slice that fails any of those additional checks is
 * downgraded to `matched_low_confidence` (asset still written, flagged) or
 * `rejected_length_anomaly`/`ambiguous_candidate` (no asset written) —
 * see Priority 5 of the Phase 2.1 diagnostic pass for why a valid-looking
 * slice must not be trusted on proximity alone.
 */
export type MainDisposition =
  | 'matched'
  | 'matched_low_confidence'
  | 'rejected_length_anomaly'
  | 'ambiguous_candidate'
  | 'no_candidate_within_threshold'
  | 'order_violation'
  | 'cross_part_gap'
  | 'boundary_anchor_inconsistency_but_resolved_independently'
  | 'boundary_anchor_inconsistency_unresolved'
  | 'degenerate_slice'
  | 'source_region_failed'
  | 'island_ambiguous'
  /** Ferry/water-taxi sections: no OSM hiking way exists for them, by design — never a failed match. */
  | 'expected_no_geometry_due_to_travel_mode';

export type BypassDisposition =
  | 'matched'
  | 'matched_low_confidence'
  | 'rejected_length_anomaly'
  | 'no_candidate_cleared_threshold'
  | 'no_candidates_available'
  | 'degenerate_slice';

/**
 * One boundary's match result. Deliberately excludes the original Trust
 * anchor coordinate — the validation report this feeds must never persist
 * Trust GPX coordinates (see validationReport.ts).
 */
export interface BoundaryMatchResult {
  officialNumber: number;
  role: BoundaryRole;
  matched: boolean;
  matchedCoordinate?: Coord;
  distanceMeters?: number;
  distanceAlongIslandKm?: number;
  regionId?: string;
  crossRegion?: boolean;
}

export interface SectionGeometryResult {
  officialNumber: number;
  kind: 'main' | 'bypass';
  produced: boolean;
  /**
   * Present whenever a slice was successfully computed, regardless of
   * `produced` — a rejected/ambiguous result keeps its candidate geometry
   * here for manual review, while `produced: false` guarantees it is never
   * written to the shippable sections asset (that filter checks both
   * `produced` and `geometry`). Absent entirely when no slice was ever
   * computed (no candidate, order violation, degenerate slice, etc.) — never
   * fabricated to fill this field.
   */
  geometry?: { type: 'LineString'; coordinates: Coord[] } | { type: 'MultiLineString'; coordinates: Coord[][] };
  lengthKm?: number;
  disposition: MainDisposition | BypassDisposition;
  matchedCandidateId?: string; // bypass only — the winning OSM alternate-relation id
  /** OSM region name(s) the matched boundaries fell in — main sections only, reporting purposes only, never used to restrict matching (see boundaryMatching.ts). */
  matchedRegionIds?: string[];
  errors: string[];
}
