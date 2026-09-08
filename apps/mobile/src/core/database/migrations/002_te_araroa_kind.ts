export const version = 2;

export const sql = `
ALTER TABLE trail_geometries ADD COLUMN kind TEXT NOT NULL DEFAULT 'main' CHECK (kind IN ('main', 'alternate'));
CREATE INDEX IF NOT EXISTS idx_trail_geometries_kind ON trail_geometries(trail_id, kind);
`;
