import type { RedistributionStatus } from '../models/Source';
import type { Section } from '../models/Section';

/**
 * The single license-gate decision, reused by every gating function below.
 * Never call this from a React component — the repository is the only place
 * that should ever decide whether a source's content may be shown; UI code
 * must be free to trust whatever a repository method returns.
 */
export function isSourceAllowed(
  redistributionStatus: RedistributionStatus | null | undefined,
  allowUnconfirmedSources: boolean,
): boolean {
  if (allowUnconfirmedSources) return true;
  return redistributionStatus === 'allowed';
}

/**
 * Fields sections authors itself, gated by the section row's own source
 * (sections.source_id) — never by the geometry's source. See Section.ts for
 * why these are typed nullable: a null here can mean "gated", not "unknown".
 */
const GATED_SECTION_FIELDS = [
  'officialNumber',
  'trustSeason',
  'officialName',
  'kind',
  'travelMode',
  'countsTowardTrailDistance',
  'relatedSectionId',
  'matchConfidence',
  'officialDistanceKm',
  'cumulativeFromKm',
  'cumulativeToKm',
  'accessStatus',
  'sourceStatusRaw',
  'legalStatus',
  'bypassReason',
  'tidalDependent',
] as const satisfies readonly (keyof Section)[];

/**
 * Redacts every Trust-authored field on a Section when its own source isn't
 * cleared for redistribution. Does not touch distanceKm/elevationGainM —
 * those are gated separately by the geometry's own source, see
 * gateGeometryDerivedFields, because provenance for those two fields is
 * inherited from `geometries.source_id`, not `sections.source_id`.
 */
export function gateSectionMetadata(section: Section, sectionSourceAllowed: boolean): Section {
  if (sectionSourceAllowed) return section;
  const redacted: Section = { ...section };
  for (const field of GATED_SECTION_FIELDS) {
    (redacted as unknown as Record<string, unknown>)[field] = null;
  }
  return redacted;
}

/**
 * Gates distanceKm/elevationGainM by the geometry's own source, independent
 * of gateSectionMetadata. A section can legitimately have Trust-pending
 * metadata (name/number/status) while its attached geometry is OSM and
 * already allowed, or vice versa.
 */
export function gateGeometryDerivedFields(section: Section, geometrySourceAllowed: boolean): Section {
  if (geometrySourceAllowed) return section;
  return { ...section, distanceKm: null, elevationGainM: null };
}
