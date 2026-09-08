export const version = 1;

export const sql = `
CREATE TABLE IF NOT EXISTS trails (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  distance_km REAL NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS trail_sections (
  id TEXT PRIMARY KEY,
  trail_id TEXT NOT NULL REFERENCES trails(id),
  name TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  distance_km REAL NOT NULL,
  elevation_gain_m REAL NOT NULL,
  difficulty TEXT NOT NULL,
  description TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_trail_sections_trail_id ON trail_sections(trail_id);
CREATE INDEX IF NOT EXISTS idx_trail_sections_sequence ON trail_sections(trail_id, sequence);

CREATE TABLE IF NOT EXISTS trail_geometries (
  trail_id TEXT NOT NULL REFERENCES trails(id),
  section_id TEXT REFERENCES trail_sections(id),
  geometry_geojson TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trail_geometries_trail_id ON trail_geometries(trail_id);
`;
