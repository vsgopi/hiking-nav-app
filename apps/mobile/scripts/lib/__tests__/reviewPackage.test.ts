import {
  buildReviewCollections,
  buildReviewManifest,
  computeManifestAccounting,
  SECTION_SEEDS,
  type IngestReportLike,
} from '../reviewPackage';
import type { SectionGeometryResult } from '../types';

/** Builds a fully-populated, internally-consistent fake report covering all 94 catalog sections, so tests can override just the disposition(s) they care about. */
function fakeReport(overrides: Partial<Record<number, Partial<SectionGeometryResult>>> = {}): IngestReportLike {
  const sections: SectionGeometryResult[] = SECTION_SEEDS.map((seed) => {
    const base: SectionGeometryResult = {
      officialNumber: seed.officialNumber,
      kind: seed.kind,
      produced: true,
      geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
      lengthKm: seed.officialDistanceKm ?? 1,
      disposition: 'matched',
      errors: [],
    };
    return { ...base, ...(overrides[seed.officialNumber] ?? {}) };
  });
  return { sections, regionFailures: [] };
}

describe('buildReviewManifest — 94-section accounting', () => {
  it('produces exactly 94 rows for a complete report', () => {
    const manifest = buildReviewManifest(fakeReport());
    expect(manifest).toHaveLength(94);
  });

  it('covers every official number 1-94 with no duplicates', () => {
    const manifest = buildReviewManifest(fakeReport());
    const numbers = manifest.map((r) => r.officialNumber).sort((a, b) => a - b);
    expect(new Set(numbers).size).toBe(94);
    for (let i = 1; i <= 94; i++) expect(numbers).toContain(i);
  });

  it('flags a catalog section missing from the report explicitly, rather than silently omitting it', () => {
    const report = fakeReport();
    report.sections = report.sections.filter((s) => s.officialNumber !== 42); // simulate a bug that dropped one row
    const manifest = buildReviewManifest(report);
    expect(manifest).toHaveLength(94); // still 94 — the catalog is the source of truth
    const missing = manifest.find((r) => r.officialNumber === 42)!;
    expect(missing.disposition).toBe('MISSING_FROM_REPORT');
    expect(missing.manualReviewRequired).toBe(true);
  });

  it('computes true catalog neighbors independent of what has geometry this run', () => {
    // Section 43 (bypass) sits between main sections 42 and 44 by number, but
    // main-kind neighbors skip bypass numbers — 42's next main neighbor is 44.
    const manifest = buildReviewManifest(fakeReport());
    const s42 = manifest.find((r) => r.officialNumber === 42)!;
    expect(s42.nextMainOrBypassOfficialNumber).toBe(44);
    const s43 = manifest.find((r) => r.officialNumber === 43)!; // the bypass itself
    expect(s43.kind).toBe('bypass');
  });

  it('marks matched and expected_no_geometry_due_to_travel_mode as not requiring manual review, everything else as requiring it', () => {
    const manifest = buildReviewManifest(
      fakeReport({
        64: { produced: false, geometry: undefined, disposition: 'expected_no_geometry_due_to_travel_mode' },
        6: { produced: false, geometry: undefined, disposition: 'rejected_length_anomaly' },
      }),
    );
    expect(manifest.find((r) => r.officialNumber === 1)!.manualReviewRequired).toBe(false); // matched
    expect(manifest.find((r) => r.officialNumber === 64)!.manualReviewRequired).toBe(false); // expected absence
    expect(manifest.find((r) => r.officialNumber === 6)!.manualReviewRequired).toBe(true); // rejected
  });

  it('reports candidateGeometryAvailable independent of geometryAssetProduced (rejected sections can still have review geometry)', () => {
    const manifest = buildReviewManifest(
      fakeReport({
        6: {
          produced: false,
          geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
          disposition: 'rejected_length_anomaly',
        },
      }),
    );
    const row = manifest.find((r) => r.officialNumber === 6)!;
    expect(row.geometryAssetProduced).toBe(false);
    expect(row.candidateGeometryAvailable).toBe(true);
  });
});

describe('computeManifestAccounting', () => {
  it('reports zero duplicates/missing for a complete manifest', () => {
    const manifest = buildReviewManifest(fakeReport());
    const accounting = computeManifestAccounting(manifest);
    expect(accounting.totalRows).toBe(94);
    expect(accounting.duplicateOfficialNumbers).toHaveLength(0);
    expect(accounting.missingOfficialNumbers).toHaveLength(0);
  });

  it('detects a missing official number', () => {
    const manifest = buildReviewManifest(fakeReport()).filter((r) => r.officialNumber !== 10);
    const accounting = computeManifestAccounting(manifest);
    expect(accounting.missingOfficialNumbers).toEqual([10]);
  });

  it('detects a duplicate official number', () => {
    const manifest = buildReviewManifest(fakeReport());
    manifest.push({ ...manifest[0] }); // duplicate section 1
    const accounting = computeManifestAccounting(manifest);
    expect(accounting.duplicateOfficialNumbers).toEqual([1]);
  });

  it('produced/lowConfidence/rejected counts match manual filtering of the manifest', () => {
    const manifest = buildReviewManifest(
      fakeReport({
        19: { disposition: 'matched_low_confidence' },
        6: { produced: false, geometry: undefined, disposition: 'rejected_length_anomaly' },
        58: { produced: false, geometry: undefined, disposition: 'ambiguous_candidate' },
      }),
    );
    const accounting = computeManifestAccounting(manifest);
    expect(accounting.lowConfidenceCount).toBe(manifest.filter((r) => r.disposition === 'matched_low_confidence').length);
    expect(accounting.rejectedOrAmbiguousCount).toBe(
      manifest.filter((r) => r.disposition === 'rejected_length_anomaly' || r.disposition === 'ambiguous_candidate').length,
    );
    expect(accounting.producedCount).toBe(manifest.filter((r) => r.geometryAssetProduced).length);
  });
});

describe('buildReviewCollections', () => {
  it('routes each disposition into exactly the correct one of the six collections', () => {
    const report = fakeReport({
      19: { disposition: 'matched_low_confidence' },
      6: { produced: false, geometry: undefined, disposition: 'rejected_length_anomaly' },
      11: { produced: false, geometry: undefined, disposition: 'order_violation' },
      44: { produced: false, geometry: undefined, disposition: 'source_region_failed' },
      64: { produced: false, geometry: undefined, disposition: 'expected_no_geometry_due_to_travel_mode' },
    });
    const manifest = buildReviewManifest(report);
    const collections = buildReviewCollections(manifest, report);

    expect(collections.lowConfidence.features.map((f) => f.properties.officialNumber)).toContain(19);
    expect(collections.rejectedOrAmbiguous.features.map((f) => f.properties.officialNumber)).toContain(6);
    expect(collections.orderViolation.features.map((f) => f.properties.officialNumber)).toContain(11);
    expect(collections.sourceRegionFailed.features.map((f) => f.properties.officialNumber)).toContain(44);
    expect(collections.expectedNoGeometry.features.map((f) => f.properties.officialNumber)).toContain(64);
    // A matched section (e.g. #1) must not appear in any rejection-style collection.
    expect(collections.rejectedOrAmbiguous.features.map((f) => f.properties.officialNumber)).not.toContain(1);
  });

  it('never fabricates geometry — a feature with no candidate geometry has geometry: null, not an invented shape', () => {
    const report = fakeReport({
      11: { produced: false, geometry: undefined, disposition: 'order_violation' }, // no slice was ever computed
    });
    const manifest = buildReviewManifest(report);
    const collections = buildReviewCollections(manifest, report);
    const feature = collections.orderViolation.features.find((f) => f.properties.officialNumber === 11)!;
    expect(feature.geometry).toBeNull();
  });

  it('includes candidate geometry when it exists even though the section was rejected', () => {
    const report = fakeReport({
      6: {
        produced: false,
        geometry: { type: 'LineString', coordinates: [[1, 1], [2, 2]] },
        disposition: 'rejected_length_anomaly',
      },
    });
    const manifest = buildReviewManifest(report);
    const collections = buildReviewCollections(manifest, report);
    const feature = collections.rejectedOrAmbiguous.features.find((f) => f.properties.officialNumber === 6)!;
    expect(feature.geometry).toEqual({ type: 'LineString', coordinates: [[1, 1], [2, 2]] });
  });
});
