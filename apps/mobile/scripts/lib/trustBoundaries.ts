import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Coord } from './types';

/**
 * Reads Te Araroa Trust Section Routes GPX boundary coordinates for the
 * in-memory ingest-time reference use described in the Phase 2 design —
 * NEVER written to any file under assets/, never returned alongside the
 * geometry it's used to cut. Callers must not persist the return value of
 * `extractSectionBoundaries` anywhere the app or its bundled assets would
 * pick it up.
 */

export interface SectionBoundary {
  officialNumber: number;
  fileName: string;
  start: Coord;
  end: Coord;
}

const FILENAME_PATTERN = /^(\d+)_(.+)\.gpx$/;

/** Extracts a GPX file's first and last <trkpt lon="…" lat="…"> as [lon, lat] tuples — GPX's own attribute order already matches this app's [longitude, latitude] convention. */
export function parseGpxBoundary(xml: string): { start: Coord; end: Coord } {
  const trkptPattern = /<trkpt\s+lon="([^"]+)"\s+lat="([^"]+)"/g;
  let match: RegExpExecArray | null;
  let first: Coord | null = null;
  let last: Coord | null = null;
  while ((match = trkptPattern.exec(xml))) {
    const coord: Coord = [parseFloat(match[1]), parseFloat(match[2])];
    if (!first) first = coord;
    last = coord;
  }
  if (!first || !last) {
    throw new Error('GPX file has no <trkpt> elements');
  }
  return { start: first, end: last };
}

/** Parses every Routes/*.gpx file in `routesDir`, keyed by the file's own leading number — never by reconstructing a filename from a DB name string. */
export function extractSectionBoundaries(routesDir: string): Map<number, SectionBoundary> {
  const files = readdirSync(routesDir).filter((f) => f.endsWith('.gpx'));
  const result = new Map<number, SectionBoundary>();

  for (const fileName of files) {
    const match = fileName.match(FILENAME_PATTERN);
    if (!match) {
      throw new Error(`Unrecognized Section Routes GPX filename (expected "<number>_<name>.gpx"): ${fileName}`);
    }
    const officialNumber = parseInt(match[1], 10);
    if (result.has(officialNumber)) {
      throw new Error(`Duplicate official_number ${officialNumber} across files ${result.get(officialNumber)!.fileName} and ${fileName}`);
    }
    const xml = readFileSync(join(routesDir, fileName), 'utf-8');
    const { start, end } = parseGpxBoundary(xml);
    result.set(officialNumber, { officialNumber, fileName, start, end });
  }

  return result;
}

export interface FetchTrustZipOptions {
  zipUrl: string;
  /** A local, git-ignored scratch directory — never assets/, never bundled. */
  scratchDir: string;
}

/**
 * Downloads (or reuses an already-downloaded copy of) the Trust's Section
 * Routes GPX zip into `scratchDir`, extracts it, and returns the path to the
 * extracted Routes/ directory. Requires `unzip` on PATH (dev-tooling only,
 * never runs on a user's device).
 */
export async function fetchAndExtractTrustZip(options: FetchTrustZipOptions): Promise<string> {
  const { zipUrl, scratchDir } = options;
  mkdirSync(scratchDir, { recursive: true });
  const zipPath = join(scratchDir, 'section-routes.zip');
  const extractedDir = join(scratchDir, 'extracted');

  if (!existsSync(zipPath)) {
    const response = await fetch(zipUrl);
    if (!response.ok) {
      throw new Error(`Failed to download Trust Section Routes GPX zip (${response.status}) from ${zipUrl}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    writeFileSync(zipPath, buffer);
  }

  if (!existsSync(extractedDir)) {
    mkdirSync(extractedDir, { recursive: true });
    execFileSync('unzip', ['-oq', zipPath, '-d', extractedDir]);
  }

  const routesDir = join(extractedDir, 'Routes');
  if (!existsSync(routesDir)) {
    throw new Error(`Expected a Routes/ directory inside the extracted zip, found none at ${extractedDir}`);
  }
  return routesDir;
}
