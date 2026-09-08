import type { SQLiteDatabase } from 'expo-sqlite';
import type { Trail } from '../models/Trail';
import type { Region } from '../models/Region';
import type { AccessStatus, MatchConfidence, Section, SectionKind } from '../models/Section';
import type { Geometry } from '../models/TrailGeometry';
import type { RedistributionStatus } from '../models/Source';
import type { TrailRepository } from './TrailRepository';
import { gateGeometryDerivedFields, gateSectionMetadata, isSourceAllowed } from './licenseGate';

interface TrailRow {
  id: string;
  name: string;
  description: string;
  distance_km: number;
  version: number;
}

interface RegionRow {
  id: string;
  trail_id: string;
  name: string;
  sequence: number;
  island: 'NI' | 'SI';
}

export interface SectionRow {
  id: string;
  trail_id: string;
  official_number: number;
  trust_season: string;
  official_name: string;
  kind: SectionKind;
  travel_mode: string;
  counts_toward_trail_distance: number;
  related_section_id: string | null;
  match_confidence: MatchConfidence | null;
  distance_km: number | null;
  official_distance_km: number | null;
  cumulative_from_km: number | null;
  cumulative_to_km: number | null;
  elevation_gain_m: number | null;
  difficulty: string | null;
  access_status: AccessStatus | null;
  source_status_raw: string | null;
  legal_status: string | null;
  bypass_reason: string | null;
  tidal_dependent: number;
  source_id: string;
  source_version: string | null;
  imported_at: string | null;
  // joined, not real columns:
  section_redistribution_status: RedistributionStatus;
  geometry_redistribution_status: RedistributionStatus | null;
}

export interface GeometryRow {
  id: number;
  section_id: string | null;
  geometry_geojson: string;
  source_id: string;
  source_version: string | null;
  imported_at: string | null;
  redistribution_status: RedistributionStatus;
}

export function mapRegionRow(row: RegionRow): Region {
  return { id: row.id, trailId: row.trail_id, name: row.name, sequence: row.sequence, island: row.island };
}

/**
 * Maps a joined section row to the fully-populated Section, then applies the
 * two independent gates: Trust-authored fields by the section's own source,
 * distanceKm/elevationGainM by the *geometry's* source. allowUnconfirmedSources
 * bypasses both gates (dev/staging only — see AppProviders.tsx).
 */
export function mapSectionRow(row: SectionRow, allowUnconfirmedSources: boolean): Section {
  const full: Section = {
    id: row.id,
    trailId: row.trail_id,
    officialNumber: row.official_number,
    trustSeason: row.trust_season,
    officialName: row.official_name,
    kind: row.kind,
    travelMode: row.travel_mode,
    countsTowardTrailDistance: !!row.counts_toward_trail_distance,
    relatedSectionId: row.related_section_id,
    matchConfidence: row.match_confidence,
    distanceKm: row.distance_km,
    officialDistanceKm: row.official_distance_km,
    cumulativeFromKm: row.cumulative_from_km,
    cumulativeToKm: row.cumulative_to_km,
    elevationGainM: row.elevation_gain_m,
    difficulty: row.difficulty,
    accessStatus: row.access_status,
    sourceStatusRaw: row.source_status_raw,
    legalStatus: row.legal_status,
    bypassReason: row.bypass_reason,
    tidalDependent: !!row.tidal_dependent,
    sourceId: row.source_id,
    sourceVersion: row.source_version,
    importedAt: row.imported_at,
  };

  const sectionAllowed = isSourceAllowed(row.section_redistribution_status, allowUnconfirmedSources);
  const geometryAllowed = isSourceAllowed(row.geometry_redistribution_status, allowUnconfirmedSources);

  return gateGeometryDerivedFields(gateSectionMetadata(full, sectionAllowed), geometryAllowed);
}

export function mapGeometryRow(row: GeometryRow): Geometry {
  return {
    id: row.id,
    sectionId: row.section_id,
    geometry: JSON.parse(row.geometry_geojson),
    sourceId: row.source_id,
    sourceVersion: row.source_version,
    importedAt: row.imported_at,
  };
}

const SECTION_SELECT = `
  SELECT
    s.*,
    src.redistribution_status AS section_redistribution_status,
    geo_src.redistribution_status AS geometry_redistribution_status
  FROM sections s
  JOIN sources src ON src.id = s.source_id
  LEFT JOIN geometries g ON g.section_id = s.id
  LEFT JOIN sources geo_src ON geo_src.id = g.source_id
`;

export class SqliteTrailRepository implements TrailRepository {
  constructor(
    private readonly db: SQLiteDatabase,
    /** Dev/staging only — see AppProviders.tsx and env.ts. Never true in a production build. */
    private readonly allowUnconfirmedSources: boolean,
  ) {}

  async getTrail(): Promise<Trail | null> {
    const row = await this.db.getFirstAsync<TrailRow>('SELECT * FROM trails LIMIT 1');
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      distanceKm: row.distance_km,
      version: row.version,
    };
  }

  async getSections(): Promise<Section[]> {
    const rows = await this.db.getAllAsync<SectionRow>(`${SECTION_SELECT} ORDER BY s.official_number ASC`);
    return rows.map((row) => mapSectionRow(row, this.allowUnconfirmedSources));
  }

  async getSection(id: string): Promise<Section | null> {
    const row = await this.db.getFirstAsync<SectionRow>(`${SECTION_SELECT} WHERE s.id = ?`, id);
    return row ? mapSectionRow(row, this.allowUnconfirmedSources) : null;
  }

  async getRegions(): Promise<Region[]> {
    const rows = await this.db.getAllAsync<RegionRow>('SELECT * FROM regions ORDER BY sequence ASC');
    return rows.map(mapRegionRow);
  }

  async getRegionsForSection(sectionId: string): Promise<Region[]> {
    const rows = await this.db.getAllAsync<RegionRow>(
      `SELECT r.* FROM section_regions sr
       JOIN regions r ON r.id = sr.region_id
       WHERE sr.section_id = ?
       ORDER BY sr.is_primary DESC, r.sequence ASC`,
      sectionId,
    );
    return rows.map(mapRegionRow);
  }

  async getMainTrailGeometry(): Promise<Geometry | null> {
    const row = await this.db.getFirstAsync<GeometryRow>(
      `SELECT g.*, src.redistribution_status AS redistribution_status
       FROM geometries g JOIN sources src ON src.id = g.source_id
       WHERE g.section_id IS NULL LIMIT 1`,
    );
    if (!row) return null;
    return isSourceAllowed(row.redistribution_status, this.allowUnconfirmedSources) ? mapGeometryRow(row) : null;
  }

  async getSectionGeometry(sectionId: string): Promise<Geometry | null> {
    const row = await this.db.getFirstAsync<GeometryRow>(
      `SELECT g.*, src.redistribution_status AS redistribution_status
       FROM geometries g JOIN sources src ON src.id = g.source_id
       WHERE g.section_id = ? LIMIT 1`,
      sectionId,
    );
    if (!row) return null;
    return isSourceAllowed(row.redistribution_status, this.allowUnconfirmedSources) ? mapGeometryRow(row) : null;
  }

  async getBypassGeometries(): Promise<Geometry[]> {
    const rows = await this.db.getAllAsync<GeometryRow>(
      `SELECT g.*, src.redistribution_status AS redistribution_status
       FROM geometries g
       JOIN sections s ON s.id = g.section_id
       JOIN sources src ON src.id = g.source_id
       WHERE s.kind = 'bypass'`,
    );
    return rows
      .filter((row) => isSourceAllowed(row.redistribution_status, this.allowUnconfirmedSources))
      .map(mapGeometryRow);
  }
}
