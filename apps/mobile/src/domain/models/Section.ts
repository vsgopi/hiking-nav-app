export type SectionKind = 'main' | 'bypass';

export const ACCESS_STATUS_VALUES = ['open', 'closed', 'seasonal'] as const;
export type AccessStatus = (typeof ACCESS_STATUS_VALUES)[number];

export function isValidAccessStatus(value: string | null): value is AccessStatus | null {
  return value === null || (ACCESS_STATUS_VALUES as readonly string[]).includes(value);
}

export const MATCH_CONFIDENCE_VALUES = ['confirmed', 'likely'] as const;
export type MatchConfidence = (typeof MATCH_CONFIDENCE_VALUES)[number];

/**
 * Deliberately a plain string, not a union enforced by the type system: the
 * `travel_mode` column is unconstrained TEXT (see migration 003) so a new
 * mode a future Trust data season introduces doesn't require a migration OR
 * a type change here. KNOWN_TRAVEL_MODES is a soft reference list for
 * display/icon logic only — never used to reject a value.
 */
export type TravelMode = string;
export const KNOWN_TRAVEL_MODES = ['foot', 'kayak', 'ferry', 'water_taxi'] as const;

/**
 * The primary navigation unit: one of the 94 official Te Araroa Trust
 * sections (81 main + 13 bypass) for a given trust_season.
 *
 * Trust-authored fields (everything except id/trailId/distanceKm/
 * elevationGainM/sourceId/sourceVersion/importedAt) are nullable here because
 * the repository's production license gate redacts them to null when their
 * source's redistributionStatus isn't 'allowed' — a null in these fields does
 * not necessarily mean "unknown", it may mean "hidden pending confirmation".
 * See domain/repositories/licenseGate.ts.
 *
 * distanceKm and elevationGainM are gated separately, by the geometry's own
 * source (see licenseGate.ts) — never by this section row's own source_id.
 */
export interface Section {
  id: string;
  trailId: string;
  officialNumber: number | null;
  trustSeason: string | null;
  officialName: string | null;
  kind: SectionKind | null;
  travelMode: TravelMode | null;
  countsTowardTrailDistance: boolean | null;
  /** For a bypass section, the main section it parallels. Null for main sections. */
  relatedSectionId: string | null;
  /** Confidence of our own name-matching between the GPX file and the KMZ's authoritative section list — not a source-provided field. */
  matchConfidence: MatchConfidence | null;
  /** Cached length of the geometry actually attached to this section. Null until that geometry is ingested. */
  distanceKm: number | null;
  /** The source's own published distance — kept separate from distanceKm; see licenseGate.ts / repository docs for which one to use where. */
  officialDistanceKm: number | null;
  cumulativeFromKm: number | null;
  cumulativeToKm: number | null;
  /** Derived from the elevation-bearing geometry attached to this section, if any. Null whenever that geometry has no elevation (true for OSM geometry in this app today). */
  elevationGainM: number | null;
  /** No official source provides this field; always null until one is found. Never fabricate a value here. */
  difficulty: string | null;
  accessStatus: AccessStatus | null;
  /** Verbatim original status string from the source, kept for traceability since the source's own STATUS field mixes concepts (access/travel-mode/kind hints). Not used by app logic. */
  sourceStatusRaw: string | null;
  legalStatus: string | null;
  bypassReason: string | null;
  tidalDependent: boolean | null;
  sourceId: string;
  sourceVersion: string | null;
  importedAt: string | null;
}
