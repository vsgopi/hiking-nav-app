import { OSM_SOURCE_ID, SOURCE_SEEDS, TRUST_SOURCE_ID } from '../sources';

describe('source provenance seeds', () => {
  it('seeds exactly one OSM source and one Trust source', () => {
    expect(SOURCE_SEEDS).toHaveLength(2);
    expect(SOURCE_SEEDS.map((s) => s.id).sort()).toEqual([OSM_SOURCE_ID, TRUST_SOURCE_ID].sort());
  });

  it('OSM is allowed, since ODbL is a well-known open license', () => {
    const osm = SOURCE_SEEDS.find((s) => s.id === OSM_SOURCE_ID)!;
    expect(osm.license).toBe('ODbL 1.0');
    expect(osm.redistributionStatus).toBe('allowed');
    expect(osm.licenseConfirmed).toBe(true);
  });

  it('the Te Araroa Trust source is never marked allowed — redistribution terms were not found stated anywhere during the audit', () => {
    const trust = SOURCE_SEEDS.find((s) => s.id === TRUST_SOURCE_ID)!;
    expect(trust.redistributionStatus).toBe('pending');
    expect(trust.licenseConfirmed).toBe(false);
    expect(trust.redistributionStatus).not.toBe('allowed');
  });

  it('every source has an id distinct from the other, so a row can be attributed to exactly one', () => {
    expect(OSM_SOURCE_ID).not.toBe(TRUST_SOURCE_ID);
  });
});
