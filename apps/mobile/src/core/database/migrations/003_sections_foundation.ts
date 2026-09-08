export const version = 3;

/**
 * Replaces the region-grained `trail_sections`/`trail_geometries` design with
 * the official Te Araroa Trust section as the primary navigation unit (94
 * sections: 81 main + 13 bypass, per the 2026-27 season data audit).
 *
 * `trail_sections` and `trail_geometries` are dropped rather than migrated:
 * the old rows (a single OSM-derived "Wellington region" smoke-test import,
 * with placeholder elevation_gain_m=0 and difficulty='moderate') don't
 * correspond to any real official section, and carrying them forward under
 * the new section-grained schema would misrepresent them as real data. This
 * is dev/seed data only, not user data — see the app's own README/comments in
 * the old seed.ts for its provenance.
 */
export const sql = `
PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS trail_geometries;
DROP TABLE IF EXISTS trail_sections;

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  attribution_text TEXT NOT NULL,
  license TEXT NOT NULL,
  license_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (license_confirmed IN (0, 1)),
  redistribution_status TEXT NOT NULL DEFAULT 'pending' CHECK (redistribution_status IN ('pending', 'allowed', 'not_allowed')),
  confirmed_by TEXT,
  confirmed_at TEXT,
  url TEXT,
  retrieved_at TEXT
);

CREATE TABLE IF NOT EXISTS regions (
  id TEXT PRIMARY KEY,
  trail_id TEXT NOT NULL REFERENCES trails(id),
  name TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  island TEXT NOT NULL CHECK (island IN ('NI', 'SI'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_regions_trail_sequence ON regions(trail_id, sequence);
CREATE UNIQUE INDEX IF NOT EXISTS idx_regions_trail_name ON regions(trail_id, name);

CREATE TABLE IF NOT EXISTS sections (
  id TEXT PRIMARY KEY,
  trail_id TEXT NOT NULL REFERENCES trails(id),
  official_number INTEGER NOT NULL,
  trust_season TEXT NOT NULL,
  official_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('main', 'bypass')),
  -- Plain TEXT, not a CHECK-constrained enum: a new travel mode in a future
  -- Trust data season should not require a migration to record. Validated
  -- only loosely at the application layer (see Section.ts).
  travel_mode TEXT NOT NULL DEFAULT 'foot',
  counts_toward_trail_distance INTEGER NOT NULL DEFAULT 1 CHECK (counts_toward_trail_distance IN (0, 1)),
  -- Deferrable: bypass rows can reference a main section inserted later in
  -- the same seeding transaction (e.g. section 47 references section 48).
  related_section_id TEXT REFERENCES sections(id) DEFERRABLE INITIALLY DEFERRED,
  match_confidence TEXT CHECK (match_confidence IN ('confirmed', 'likely')),
  distance_km REAL,
  official_distance_km REAL,
  cumulative_from_km REAL,
  cumulative_to_km REAL,
  elevation_gain_m REAL,
  difficulty TEXT,
  access_status TEXT CHECK (access_status IN ('open', 'closed', 'seasonal')),
  source_status_raw TEXT,
  legal_status TEXT,
  bypass_reason TEXT,
  tidal_dependent INTEGER NOT NULL DEFAULT 0 CHECK (tidal_dependent IN (0, 1)),
  source_id TEXT NOT NULL REFERENCES sources(id),
  source_version TEXT,
  imported_at TEXT,
  CHECK (kind = 'bypass' OR related_section_id IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sections_trail_season_number ON sections(trail_id, trust_season, official_number);
CREATE INDEX IF NOT EXISTS idx_sections_kind ON sections(kind);
CREATE INDEX IF NOT EXISTS idx_sections_related_section ON sections(related_section_id);
CREATE INDEX IF NOT EXISTS idx_sections_source ON sections(source_id);

CREATE TABLE IF NOT EXISTS section_regions (
  section_id TEXT NOT NULL REFERENCES sections(id),
  region_id TEXT NOT NULL REFERENCES regions(id),
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  PRIMARY KEY (section_id, region_id)
);
CREATE INDEX IF NOT EXISTS idx_section_regions_region ON section_regions(region_id);
-- At most one primary region per section (a partial unique index correctly
-- enforces this for non-null/true values; SQLite's NULL-distinctness quirk,
-- which would defeat a naive unique index, doesn't apply here since is_primary
-- is never NULL).
CREATE UNIQUE INDEX IF NOT EXISTS idx_section_regions_one_primary ON section_regions(section_id) WHERE is_primary = 1;

CREATE TABLE IF NOT EXISTS geometries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id TEXT REFERENCES sections(id),
  geometry_geojson TEXT NOT NULL,
  source_id TEXT NOT NULL REFERENCES sources(id),
  source_version TEXT,
  imported_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_geometries_section ON geometries(section_id);
-- At most one geometry row per real section. Deliberately not enforcing
-- "at most one whole-trail (section_id IS NULL) row" at the DB level: SQLite
-- treats every NULL as distinct for uniqueness purposes, so a partial index
-- on NULL values can't express that constraint; ingestion is responsible for
-- keeping it to one row, same as the app already relied on before this
-- migration (getFirstAsync ... LIMIT 1).
CREATE UNIQUE INDEX IF NOT EXISTS idx_geometries_one_per_section ON geometries(section_id) WHERE section_id IS NOT NULL;

PRAGMA foreign_keys = ON;
`;
