import { mapSectionRow, type SectionRow } from '../SqliteTrailRepository';

/**
 * Tests the row-mapping/gating logic in isolation from SQLite (a native
 * module unavailable in this Jest environment) by constructing the exact
 * row shape the join query in SqliteTrailRepository.ts produces.
 */
function makeRow(overrides: Partial<SectionRow> = {}): SectionRow {
  return {
    id: 'te-araroa-01',
    trail_id: 'te-araroa',
    official_number: 1,
    trust_season: '2026-27',
    official_name: 'Cape Reinga to Ahipara',
    kind: 'main',
    travel_mode: 'foot',
    counts_toward_trail_distance: 1,
    related_section_id: null,
    match_confidence: null,
    distance_km: null,
    official_distance_km: 101.2,
    cumulative_from_km: 0,
    cumulative_to_km: 101.2,
    elevation_gain_m: null,
    difficulty: null,
    access_status: 'open',
    source_status_raw: 'open',
    legal_status: null,
    bypass_reason: null,
    tidal_dependent: 0,
    source_id: 'ta-trust-2026-27',
    source_version: '2026-27',
    imported_at: '2026-09-06',
    section_redistribution_status: 'pending',
    geometry_redistribution_status: null,
    ...overrides,
  };
}

describe('mapSectionRow — distance/elevation derive from geometry, not section metadata', () => {
  it('distanceKm is null when no geometry has been ingested for this section', () => {
    const section = mapSectionRow(makeRow({ distance_km: null, geometry_redistribution_status: null }), false);
    expect(section.distanceKm).toBeNull();
  });

  it('distanceKm passes through when the geometry exists and its source is allowed, even if section metadata is Trust-pending', () => {
    const section = mapSectionRow(
      makeRow({
        distance_km: 101.33,
        section_redistribution_status: 'pending',
        geometry_redistribution_status: 'allowed',
      }),
      false,
    );
    expect(section.distanceKm).toBe(101.33);
    // Section metadata is still redacted independently — a geometry being
    // OSM/allowed does not clear the Trust-authored fields.
    expect(section.officialName).toBeNull();
  });

  it('elevationGainM stays null when the attached geometry has no elevation (true for OSM geometry in this app today)', () => {
    const section = mapSectionRow(
      makeRow({
        distance_km: 101.33,
        elevation_gain_m: null,
        geometry_redistribution_status: 'allowed',
      }),
      false,
    );
    expect(section.elevationGainM).toBeNull();
  });

  it('elevationGainM passes through only when its geometry source is allowed', () => {
    const gated = mapSectionRow(
      makeRow({ elevation_gain_m: 500, geometry_redistribution_status: 'pending' }),
      false,
    );
    expect(gated.elevationGainM).toBeNull();

    const allowed = mapSectionRow(
      makeRow({ elevation_gain_m: 500, geometry_redistribution_status: 'allowed' }),
      false,
    );
    expect(allowed.elevationGainM).toBe(500);
  });
});

describe('mapSectionRow — production license gate', () => {
  it('redacts Trust-authored fields when the section source is pending, in production', () => {
    const section = mapSectionRow(makeRow({ section_redistribution_status: 'pending' }), false);
    expect(section.officialNumber).toBeNull();
    expect(section.officialName).toBeNull();
    expect(section.kind).toBeNull();
    expect(section.accessStatus).toBeNull();
  });

  it('serves full Trust-authored fields in dev/staging (allowUnconfirmedSources=true) even while pending', () => {
    const section = mapSectionRow(makeRow({ section_redistribution_status: 'pending' }), true);
    expect(section.officialNumber).toBe(1);
    expect(section.officialName).toBe('Cape Reinga to Ahipara');
  });

  it('serves full fields in production once the source is actually allowed', () => {
    const section = mapSectionRow(makeRow({ section_redistribution_status: 'allowed' }), false);
    expect(section.officialName).toBe('Cape Reinga to Ahipara');
  });

  it('never exposes id/trailId/sourceId regardless of gating — those are structural, not authored content', () => {
    const section = mapSectionRow(makeRow({ section_redistribution_status: 'pending' }), false);
    expect(section.id).toBe('te-araroa-01');
    expect(section.trailId).toBe('te-araroa');
    expect(section.sourceId).toBe('ta-trust-2026-27');
  });
});
