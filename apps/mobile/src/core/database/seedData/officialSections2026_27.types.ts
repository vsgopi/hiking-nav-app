import type { AccessStatus, MatchConfidence, SectionKind, TravelMode } from '../../../domain/models/Section';
import type { Island } from '../../../domain/models/Region';

export interface RegionSeed {
  id: string;
  name: string;
  sequence: number;
  island: Island;
}

/** One row of the official 2026-27 section catalog, before it's written to the `sections` table. */
export interface OfficialSectionSeed {
  id: string;
  officialNumber: number;
  officialName: string;
  kind: SectionKind;
  travelMode: TravelMode;
  countsTowardTrailDistance: boolean;
  relatedSectionId: string | null;
  matchConfidence: MatchConfidence | null;
  officialDistanceKm: number | null;
  cumulativeFromKm: number | null;
  cumulativeToKm: number | null;
  accessStatus: AccessStatus | null;
  sourceStatusRaw: string | null;
  bypassReason: string | null;
  tidalDependent: boolean;
}

export interface SectionRegionSeed {
  sectionId: string;
  regionId: string;
  isPrimary: boolean;
}
