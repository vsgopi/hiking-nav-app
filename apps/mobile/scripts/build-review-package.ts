/**
 * Builds the Phase 2.3 Manual Geometry Review Package from the most recent
 * ingest report already on disk (scripts/.out/ingest-report-*.json). Does
 * NOT run any OSM/Trust fetching or matching — pure post-processing of
 * existing ingestion output, so it is safe and fast to re-run any time.
 *
 * Run with: npx tsx scripts/build-review-package.ts
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReviewCollections, buildReviewManifest, computeManifestAccounting, type IngestReportLike } from './lib/reviewPackage';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '.out');
const GEOJSON_DIR = join(OUT_DIR, 'review-geojson');

function findLatestReport(): string {
  if (!existsSync(OUT_DIR)) throw new Error(`${OUT_DIR} does not exist — run the ingest first (npm run ingest:trail).`);
  const reportFiles = readdirSync(OUT_DIR).filter((f) => /^ingest-report-\d+\.json$/.test(f));
  if (reportFiles.length === 0) throw new Error('No ingest-report-*.json files found — run the ingest first.');
  reportFiles.sort((a, b) => {
    const ta = Number(a.match(/(\d+)/)![1]);
    const tb = Number(b.match(/(\d+)/)![1]);
    return tb - ta;
  });
  return join(OUT_DIR, reportFiles[0]);
}

function main() {
  const reportPath = findLatestReport();
  console.log(`Using report: ${reportPath}`);
  const report = JSON.parse(readFileSync(reportPath, 'utf-8')) as IngestReportLike;

  const manifest = buildReviewManifest(report);
  const accounting = computeManifestAccounting(manifest);

  console.log(`\n94-section accounting:`);
  console.log(`  total rows: ${accounting.totalRows}`);
  console.log(`  duplicate official numbers: ${accounting.duplicateOfficialNumbers.length ? accounting.duplicateOfficialNumbers.join(', ') : 'none'}`);
  console.log(`  missing official numbers: ${accounting.missingOfficialNumbers.length ? accounting.missingOfficialNumbers.join(', ') : 'none'}`);
  console.log(`  produced (asset written): ${accounting.producedCount}`);
  console.log(`  low confidence: ${accounting.lowConfidenceCount}`);
  console.log(`  rejected/ambiguous: ${accounting.rejectedOrAmbiguousCount}`);

  if (accounting.totalRows !== 94 || accounting.duplicateOfficialNumbers.length > 0 || accounting.missingOfficialNumbers.length > 0) {
    console.error('\n[FAILED] Manifest accounting is inconsistent — see counts above. Review package NOT written.');
    process.exitCode = 1;
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const manifestPath = join(OUT_DIR, 'review-manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
  console.log(`\nManifest written to ${manifestPath}`);

  const collections = buildReviewCollections(manifest, report);
  mkdirSync(GEOJSON_DIR, { recursive: true });
  const files: Record<string, string> = {
    'A-accepted.geojson': 'accepted',
    'B-low-confidence.geojson': 'lowConfidence',
    'C-rejected-or-ambiguous.geojson': 'rejectedOrAmbiguous',
    'D-order-violation.geojson': 'orderViolation',
    'E-source-region-failed.geojson': 'sourceRegionFailed',
    'F-expected-no-geometry.geojson': 'expectedNoGeometry',
  };
  for (const [fileName, key] of Object.entries(files)) {
    const path = join(GEOJSON_DIR, fileName);
    const collection = (collections as Record<string, (typeof collections)['accepted']>)[key];
    writeFileSync(path, JSON.stringify(collection, null, 1));
    console.log(`  ${fileName}: ${collection.features.length} feature(s)`);
  }

  console.log(`\nReview package complete.`);
}

main();
