import type { SQLiteDatabase } from 'expo-sqlite';
import { logger } from '../logging/logger';
import { keyValueStore } from '../storage/keyValueStore';
import { REGION_SEEDS, SECTION_REGION_SEEDS, SECTION_SEEDS, TRUST_SEASON } from './seedData/officialSections2026_27';
import { SOURCE_SEEDS, TRUST_SOURCE_ID } from './seedData/sources';

// Bumped because the seed dataset's *shape* changed (region-grained ->
// section-grained), so existing dev installs (which persist this flag once
// seeded) pick up the new schema instead of silently keeping stale data.
const SEED_FLAG_KEY = 'hasSeededTrailDataV3';
const TRAIL_ID = 'te-araroa';
const TRAIL_NAME = 'Te Araroa Trail';

// The Trust's own published cumulative total (Cape Reinga -> Bluff), read
// directly from the official section catalog rather than summed here, so it
// can never drift from the numbers actually seeded below.
const OFFICIAL_TOTAL_DISTANCE_KM = Math.max(
  ...SECTION_SEEDS.filter((s) => s.cumulativeToKm !== null).map((s) => s.cumulativeToKm as number),
);

const SEED_IMPORTED_AT = '2026-09-06';

export async function seedTrailDataIfNeeded(db: SQLiteDatabase): Promise<void> {
  if (keyValueStore.getBoolean(SEED_FLAG_KEY)) {
    return;
  }

  await db.execAsync('BEGIN TRANSACTION');
  try {
    for (const source of SOURCE_SEEDS) {
      await db.runAsync(
        `INSERT OR REPLACE INTO sources
         (id, name, attribution_text, license, license_confirmed, redistribution_status, confirmed_by, confirmed_at, url, retrieved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        source.id,
        source.name,
        source.attributionText,
        source.license,
        source.licenseConfirmed ? 1 : 0,
        source.redistributionStatus,
        source.confirmedBy,
        source.confirmedAt,
        source.url,
        source.retrievedAt,
      );
    }

    await db.runAsync(
      'INSERT OR REPLACE INTO trails (id, name, description, distance_km, version) VALUES (?, ?, ?, ?, ?)',
      TRAIL_ID,
      TRAIL_NAME,
      `${TRAIL_NAME}, New Zealand. Section catalog imported from the Te Araroa Trust ${TRUST_SEASON} season data ` +
        '(pending redistribution confirmation — see the sources table). Section and trail-line geometry not yet ingested.',
      OFFICIAL_TOTAL_DISTANCE_KM,
      1,
    );

    for (const region of REGION_SEEDS) {
      await db.runAsync(
        'INSERT OR REPLACE INTO regions (id, trail_id, name, sequence, island) VALUES (?, ?, ?, ?, ?)',
        region.id,
        TRAIL_ID,
        region.name,
        region.sequence,
        region.island,
      );
    }

    // Main sections before bypass sections: a few bypasses (e.g. the
    // Whanganui River ones) reference a related main section with a *higher*
    // official_number than themselves, so a simple ascending-number order
    // isn't guaranteed to insert every referenced row first. related_section_id
    // is also DEFERRABLE INITIALLY DEFERRED (see migration 003) as a second,
    // independent safeguard against forward-reference ordering.
    const orderedSections = [...SECTION_SEEDS].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'main' ? -1 : 1;
      return a.officialNumber - b.officialNumber;
    });

    for (const section of orderedSections) {
      await db.runAsync(
        `INSERT OR REPLACE INTO sections (
           id, trail_id, official_number, trust_season, official_name, kind, travel_mode,
           counts_toward_trail_distance, related_section_id, match_confidence,
           distance_km, official_distance_km, cumulative_from_km, cumulative_to_km,
           elevation_gain_m, difficulty, access_status, source_status_raw, legal_status,
           bypass_reason, tidal_dependent, source_id, source_version, imported_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        section.id,
        TRAIL_ID,
        section.officialNumber,
        TRUST_SEASON,
        section.officialName,
        section.kind,
        section.travelMode,
        section.countsTowardTrailDistance ? 1 : 0,
        section.relatedSectionId,
        section.matchConfidence,
        // distance_km: derived from geometry, which isn't ingested in this
        // phase — never fabricate it from official_distance_km instead.
        null,
        section.officialDistanceKm,
        section.cumulativeFromKm,
        section.cumulativeToKm,
        // elevation_gain_m: only ever derivable from an elevation-bearing
        // geometry; none is attached yet.
        null,
        // difficulty: no official source provides this field at all.
        null,
        section.accessStatus,
        section.sourceStatusRaw,
        // legal_status: not aggregated to section grain during the audit;
        // leave null rather than guess.
        null,
        section.bypassReason,
        section.tidalDependent ? 1 : 0,
        TRUST_SOURCE_ID,
        TRUST_SEASON,
        SEED_IMPORTED_AT,
      );
    }

    for (const sectionRegion of SECTION_REGION_SEEDS) {
      await db.runAsync(
        'INSERT OR REPLACE INTO section_regions (section_id, region_id, is_primary) VALUES (?, ?, ?)',
        sectionRegion.sectionId,
        sectionRegion.regionId,
        sectionRegion.isPrimary ? 1 : 0,
      );
    }

    await db.execAsync('COMMIT');
  } catch (error) {
    await db.execAsync('ROLLBACK');
    logger.error('Failed to seed trail data', error);
    throw error;
  }

  keyValueStore.setBoolean(SEED_FLAG_KEY, true);
  logger.info(
    `Seeded "${TRAIL_NAME}" catalog: ${SECTION_SEEDS.length} official ${TRUST_SEASON} sections ` +
      `(${SECTION_SEEDS.filter((s) => s.kind === 'main').length} main, ` +
      `${SECTION_SEEDS.filter((s) => s.kind === 'bypass').length} bypass), ${REGION_SEEDS.length} regions. ` +
      'No section/trail-line geometry ingested yet (a later phase).',
  );
}
