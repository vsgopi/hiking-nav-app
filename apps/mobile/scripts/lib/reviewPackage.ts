/**
 * Pure builders for the Phase 2.3 Manual Geometry Review Package. Consumes
 * an already-generated ingest report (scripts/.out/ingest-report-*.json) and
 * the official section catalog — never re-runs matching, never fabricates
 * geometry. Kept in scripts/lib/ (not the CLI script itself) so this is
 * independently unit-testable.
 */
import { REGION_SEEDS, SECTION_REGION_SEEDS, SECTION_SEEDS } from '../../src/core/database/seedData/officialSections2026_27';
import type { OfficialSectionSeed } from '../../src/core/database/seedData/officialSections2026_27.types';
import type { SectionGeometryResult } from './types';

export interface IngestReportLike {
  sections: SectionGeometryResult[];
  regionFailures: { relationId: number; name: string; error: string }[];
}

/**
 * A section's true catalog neighbor by official_number — computed from the
 * full 94-section catalog, never from "whichever sections happen to have
 * geometry this run". This is the fix for the Phase 2.2 cosmetic bug's
 * reporting-side equivalent: review tooling must not treat two sections as
 * neighbors just because they're adjacent in a filtered/partial list.
 */
function trueNeighbors(kind: 'main' | 'bypass', officialNumber: number): { previous: number | null; next: number | null } {
  const sameKindSorted = SECTION_SEEDS.filter((s) => s.kind === kind)
    .map((s) => s.officialNumber)
    .sort((a, b) => a - b);
  const idx = sameKindSorted.indexOf(officialNumber);
  return {
    previous: idx > 0 ? sameKindSorted[idx - 1] : null,
    next: idx >= 0 && idx < sameKindSorted.length - 1 ? sameKindSorted[idx + 1] : null,
  };
}

const NOT_REVIEW_REQUIRED_DISPOSITIONS = new Set(['matched', 'expected_no_geometry_due_to_travel_mode']);

export interface ReviewManifestRow {
  officialNumber: number;
  officialName: string;
  kind: 'main' | 'bypass';
  travelMode: string;
  officialDistanceKm: number | null;
  computedDistanceKm: number | null;
  disposition: string;
  confidence: 'confirmed' | 'low_confidence' | 'rejected' | 'not_attempted' | 'not_applicable';
  regionIds: string[];
  matchedRegionIds: string[] | null;
  matchedCandidateId: string | null;
  reviewNote: string;
  geometryAssetProduced: boolean;
  candidateGeometryAvailable: boolean;
  manualReviewRequired: boolean;
  previousMainOrBypassOfficialNumber: number | null;
  nextMainOrBypassOfficialNumber: number | null;
}

function confidenceFor(disposition: string): ReviewManifestRow['confidence'] {
  if (disposition === 'matched') return 'confirmed';
  if (disposition === 'matched_low_confidence') return 'low_confidence';
  if (disposition === 'expected_no_geometry_due_to_travel_mode') return 'not_applicable';
  if (['rejected_length_anomaly', 'ambiguous_candidate', 'order_violation', 'degenerate_slice'].includes(disposition)) {
    return 'rejected';
  }
  return 'not_attempted'; // no_candidate_*, source_region_failed, island_ambiguous
}

function reviewNoteFor(disposition: string, errors: string[]): string {
  const first = errors[0] ?? '';
  switch (disposition) {
    case 'matched':
      return 'No known issue.';
    case 'matched_low_confidence':
      return `Accepted but flagged: ${first}`;
    case 'rejected_length_anomaly':
      return `Rejected — computed length inconsistent with official distance: ${first}`;
    case 'ambiguous_candidate':
      return `Rejected — resolved interval overlaps another section: ${first}`;
    case 'order_violation':
      return 'Rejected — matched boundaries resolved in reversed/inconsistent order (self-proximity or orientation issue).';
    case 'degenerate_slice':
      return 'Rejected — slicing produced fewer than 2 usable points.';
    case 'no_candidate_within_threshold':
    case 'no_candidate_cleared_threshold':
      return 'No OSM candidate found within the configured threshold.';
    case 'no_candidates_available':
      return 'No OSM alternate-relation candidates exist for this bypass at all.';
    case 'source_region_failed':
      return "Not attempted — this section's own OSM region failed validation this run (see the region-failure record).";
    case 'expected_no_geometry_due_to_travel_mode':
      return 'Expected — ferry/water-taxi leg, no OSM hiking way exists for this by design. Not an ingestion failure.';
    case 'island_ambiguous':
      return 'Island could not be determined from metadata or geometry fallback.';
    default:
      return first || 'No further detail recorded.';
  }
}

export function buildReviewManifest(report: IngestReportLike): ReviewManifestRow[] {
  const resultByNumber = new Map(report.sections.map((s) => [s.officialNumber, s]));
  const regionsBySectionId = new Map<string, string[]>();
  for (const row of SECTION_REGION_SEEDS) {
    const list = regionsBySectionId.get(row.sectionId) ?? [];
    list.push(row.regionId);
    regionsBySectionId.set(row.sectionId, list);
  }

  // Source of truth for iteration is the full catalog (94 rows), not
  // whatever happens to be present in the report — a report with a missing
  // row still surfaces every catalog section here, explicitly flagged.
  const rows: ReviewManifestRow[] = [];
  for (const seed of SECTION_SEEDS as OfficialSectionSeed[]) {
    const result = resultByNumber.get(seed.officialNumber);
    const { previous, next } = trueNeighbors(seed.kind, seed.officialNumber);
    const regionIds = regionsBySectionId.get(`te-araroa-${String(seed.officialNumber).padStart(2, '0')}`) ?? [];

    if (!result) {
      rows.push({
        officialNumber: seed.officialNumber,
        officialName: seed.officialName,
        kind: seed.kind,
        travelMode: seed.travelMode,
        officialDistanceKm: seed.officialDistanceKm,
        computedDistanceKm: null,
        disposition: 'MISSING_FROM_REPORT',
        confidence: 'not_attempted',
        regionIds,
        matchedRegionIds: null,
        matchedCandidateId: null,
        reviewNote: 'This catalog section has no corresponding row in the ingest report at all — investigate the ingest run.',
        geometryAssetProduced: false,
        candidateGeometryAvailable: false,
        manualReviewRequired: true,
        previousMainOrBypassOfficialNumber: previous,
        nextMainOrBypassOfficialNumber: next,
      });
      continue;
    }

    rows.push({
      officialNumber: seed.officialNumber,
      officialName: seed.officialName,
      kind: seed.kind,
      travelMode: seed.travelMode,
      officialDistanceKm: seed.officialDistanceKm,
      computedDistanceKm: result.lengthKm ?? null,
      disposition: result.disposition,
      confidence: confidenceFor(result.disposition),
      regionIds,
      matchedRegionIds: result.matchedRegionIds ?? null,
      matchedCandidateId: result.matchedCandidateId ?? null,
      reviewNote: reviewNoteFor(result.disposition, result.errors),
      geometryAssetProduced: result.produced,
      candidateGeometryAvailable: Boolean(result.geometry),
      manualReviewRequired: !NOT_REVIEW_REQUIRED_DISPOSITIONS.has(result.disposition),
      previousMainOrBypassOfficialNumber: previous,
      nextMainOrBypassOfficialNumber: next,
    });
  }

  return rows.sort((a, b) => a.officialNumber - b.officialNumber);
}

export interface GeoJsonFeatureCollection {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    properties: Record<string, unknown>;
    geometry: SectionGeometryResult['geometry'] | null;
  }[];
}

function featureFor(row: ReviewManifestRow, result: SectionGeometryResult | undefined): GeoJsonFeatureCollection['features'][number] {
  return {
    type: 'Feature',
    properties: {
      officialNumber: row.officialNumber,
      officialName: row.officialName,
      kind: row.kind,
      disposition: row.disposition,
      confidence: row.confidence,
      officialDistanceKm: row.officialDistanceKm,
      computedDistanceKm: row.computedDistanceKm,
      reviewNote: row.reviewNote,
    },
    geometry: result?.geometry ?? null,
  };
}

/**
 * Builds the six review collections (A-F) directly from the manifest +
 * report, using existing candidate geometry only — never fabricated, never
 * re-derived from a fresh matching run.
 */
export function buildReviewCollections(
  manifest: ReviewManifestRow[],
  report: IngestReportLike,
): Record<'accepted' | 'lowConfidence' | 'rejectedOrAmbiguous' | 'orderViolation' | 'sourceRegionFailed' | 'expectedNoGeometry', GeoJsonFeatureCollection> {
  const resultByNumber = new Map(report.sections.map((s) => [s.officialNumber, s]));
  const collectionFor = (predicate: (row: ReviewManifestRow) => boolean): GeoJsonFeatureCollection => ({
    type: 'FeatureCollection',
    features: manifest.filter(predicate).map((row) => featureFor(row, resultByNumber.get(row.officialNumber))),
  });

  return {
    accepted: collectionFor((r) => r.disposition === 'matched'),
    lowConfidence: collectionFor((r) => r.disposition === 'matched_low_confidence'),
    rejectedOrAmbiguous: collectionFor((r) => r.disposition === 'rejected_length_anomaly' || r.disposition === 'ambiguous_candidate'),
    orderViolation: collectionFor((r) => r.disposition === 'order_violation'),
    sourceRegionFailed: collectionFor((r) => r.disposition === 'source_region_failed'),
    expectedNoGeometry: collectionFor((r) => r.disposition === 'expected_no_geometry_due_to_travel_mode'),
  };
}

export interface ManifestAccounting {
  totalRows: number;
  duplicateOfficialNumbers: number[];
  missingOfficialNumbers: number[];
  producedCount: number;
  lowConfidenceCount: number;
  rejectedOrAmbiguousCount: number;
}

/** Used both by the CLI summary and directly by tests — the accounting checks the final report must prove. */
export function computeManifestAccounting(manifest: ReviewManifestRow[]): ManifestAccounting {
  const expectedNumbers = SECTION_SEEDS.map((s) => s.officialNumber);
  const seen = new Map<number, number>();
  for (const row of manifest) seen.set(row.officialNumber, (seen.get(row.officialNumber) ?? 0) + 1);

  const duplicateOfficialNumbers = [...seen.entries()].filter(([, count]) => count > 1).map(([n]) => n);
  const presentNumbers = new Set(manifest.map((r) => r.officialNumber));
  const missingOfficialNumbers = expectedNumbers.filter((n) => !presentNumbers.has(n));

  return {
    totalRows: manifest.length,
    duplicateOfficialNumbers,
    missingOfficialNumbers,
    producedCount: manifest.filter((r) => r.geometryAssetProduced).length,
    lowConfidenceCount: manifest.filter((r) => r.disposition === 'matched_low_confidence').length,
    rejectedOrAmbiguousCount: manifest.filter((r) => r.disposition === 'rejected_length_anomaly' || r.disposition === 'ambiguous_candidate').length,
  };
}

// Re-exported for callers that want the raw catalog without importing the
// (longer) seed-data module path directly.
export { SECTION_SEEDS, SECTION_REGION_SEEDS, REGION_SEEDS };
