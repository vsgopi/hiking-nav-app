import { gateGeometryDerivedFields, gateSectionMetadata, isSourceAllowed } from '../licenseGate';
import type { Section } from '../../models/Section';

const fullSection: Section = {
  id: 'te-araroa-01',
  trailId: 'te-araroa',
  officialNumber: 1,
  trustSeason: '2026-27',
  officialName: 'Cape Reinga to Ahipara',
  kind: 'main',
  travelMode: 'foot',
  countsTowardTrailDistance: true,
  relatedSectionId: null,
  matchConfidence: null,
  distanceKm: 101.33,
  officialDistanceKm: 101.2,
  cumulativeFromKm: 0,
  cumulativeToKm: 101.2,
  elevationGainM: 1234,
  difficulty: null,
  accessStatus: 'open',
  sourceStatusRaw: 'open',
  legalStatus: 'DOC',
  bypassReason: null,
  tidalDependent: false,
  sourceId: 'ta-trust-2026-27',
  sourceVersion: '2026-27',
  importedAt: '2026-09-06',
};

describe('isSourceAllowed', () => {
  it('allows an explicitly allowed source', () => {
    expect(isSourceAllowed('allowed', false)).toBe(true);
  });

  it('blocks a pending source in production', () => {
    expect(isSourceAllowed('pending', false)).toBe(false);
  });

  it('blocks a not_allowed source in production', () => {
    expect(isSourceAllowed('not_allowed', false)).toBe(false);
  });

  it('blocks a null/unknown status in production', () => {
    expect(isSourceAllowed(null, false)).toBe(false);
    expect(isSourceAllowed(undefined, false)).toBe(false);
  });

  it('allows a pending source when allowUnconfirmedSources is set (dev/staging)', () => {
    expect(isSourceAllowed('pending', true)).toBe(true);
  });
});

describe('gateSectionMetadata', () => {
  it('returns the section unchanged when its source is allowed', () => {
    expect(gateSectionMetadata(fullSection, true)).toEqual(fullSection);
  });

  it('redacts every Trust-authored field when the source is not allowed', () => {
    const gated = gateSectionMetadata(fullSection, false);
    expect(gated.officialNumber).toBeNull();
    expect(gated.officialName).toBeNull();
    expect(gated.kind).toBeNull();
    expect(gated.travelMode).toBeNull();
    expect(gated.countsTowardTrailDistance).toBeNull();
    expect(gated.cumulativeFromKm).toBeNull();
    expect(gated.cumulativeToKm).toBeNull();
    expect(gated.officialDistanceKm).toBeNull();
    expect(gated.accessStatus).toBeNull();
    expect(gated.sourceStatusRaw).toBeNull();
    expect(gated.legalStatus).toBeNull();
    expect(gated.bypassReason).toBeNull();
    expect(gated.tidalDependent).toBeNull();
    expect(gated.trustSeason).toBeNull();
    expect(gated.matchConfidence).toBeNull();
    expect(gated.relatedSectionId).toBeNull();
  });

  it('never redacts structural/provenance fields', () => {
    const gated = gateSectionMetadata(fullSection, false);
    expect(gated.id).toBe(fullSection.id);
    expect(gated.trailId).toBe(fullSection.trailId);
    expect(gated.sourceId).toBe(fullSection.sourceId);
    expect(gated.sourceVersion).toBe(fullSection.sourceVersion);
    expect(gated.importedAt).toBe(fullSection.importedAt);
  });

  it('never redacts geometry-derived fields — those are gated separately', () => {
    const gated = gateSectionMetadata(fullSection, false);
    expect(gated.distanceKm).toBe(fullSection.distanceKm);
    expect(gated.elevationGainM).toBe(fullSection.elevationGainM);
  });
});

describe('gateGeometryDerivedFields', () => {
  it('leaves distanceKm/elevationGainM untouched when the geometry source is allowed', () => {
    const result = gateGeometryDerivedFields(fullSection, true);
    expect(result.distanceKm).toBe(fullSection.distanceKm);
    expect(result.elevationGainM).toBe(fullSection.elevationGainM);
  });

  it('nulls distanceKm/elevationGainM when the geometry source is not allowed', () => {
    const result = gateGeometryDerivedFields(fullSection, false);
    expect(result.distanceKm).toBeNull();
    expect(result.elevationGainM).toBeNull();
  });

  it('does not touch Trust-authored fields — those are gated separately by gateSectionMetadata', () => {
    const result = gateGeometryDerivedFields(fullSection, false);
    expect(result.officialName).toBe(fullSection.officialName);
    expect(result.officialNumber).toBe(fullSection.officialNumber);
  });

  it('composes independently: Trust metadata gated, geometry allowed', () => {
    const result = gateGeometryDerivedFields(gateSectionMetadata(fullSection, false), true);
    expect(result.officialName).toBeNull();
    expect(result.distanceKm).toBe(fullSection.distanceKm);
  });

  it('composes independently: Trust metadata allowed, geometry gated', () => {
    const result = gateGeometryDerivedFields(gateSectionMetadata(fullSection, true), false);
    expect(result.officialName).toBe(fullSection.officialName);
    expect(result.distanceKm).toBeNull();
  });
});
