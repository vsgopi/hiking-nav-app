import {
  computeCompletionPercentage,
  computeNavigationState,
  computeSectionRelativeProgress,
  isOffTrail,
  resolveCurrentSection,
} from '../NavigationEngine';
import type { TrailGeometryShape } from '../../models/TrailGeometry';
import type { Section } from '../../models/Section';
import { lineStringLengthKm } from '../../../shared/utils/geo';

// A straight line along the equator from (0,0) to (0.02,0) — roughly 2.226km,
// since 1 degree of longitude at the equator is ~111.32km.
const straightLineGeometry: TrailGeometryShape = {
  type: 'LineString',
  coordinates: [
    [0, 0],
    [0.01, 0],
    [0.02, 0],
  ],
};

const totalDistanceKm = 2.226;

function makeSection(overrides: Partial<Section> & Pick<Section, 'id' | 'officialNumber'>): Section {
  return {
    trailId: 'trail-1',
    trustSeason: '2026-27',
    officialName: `Section ${overrides.officialNumber}`,
    kind: 'main',
    travelMode: 'foot',
    countsTowardTrailDistance: true,
    relatedSectionId: null,
    matchConfidence: null,
    distanceKm: 1.113,
    officialDistanceKm: 1.113,
    cumulativeFromKm: null,
    cumulativeToKm: null,
    elevationGainM: null,
    difficulty: null,
    accessStatus: 'open',
    sourceStatusRaw: null,
    legalStatus: null,
    bypassReason: null,
    tidalDependent: false,
    sourceId: 'ta-trust-2026-27',
    sourceVersion: '2026-27',
    importedAt: null,
    ...overrides,
  };
}

const sections: Section[] = [
  makeSection({ id: 'sec-1', officialNumber: 1 }),
  makeSection({ id: 'sec-2', officialNumber: 2 }),
];

describe('isOffTrail', () => {
  it('is false within the default threshold', () => {
    expect(isOffTrail(30)).toBe(false);
  });

  it('is true beyond the default threshold', () => {
    expect(isOffTrail(100)).toBe(true);
  });

  it('respects a custom threshold', () => {
    expect(isOffTrail(60, 100)).toBe(false);
  });
});

describe('resolveCurrentSection', () => {
  it('resolves the first section near the start', () => {
    expect(resolveCurrentSection(0.1, sections)?.id).toBe('sec-1');
  });

  it('resolves the second section past the first boundary', () => {
    expect(resolveCurrentSection(1.5, sections)?.id).toBe('sec-2');
  });

  it('falls back to the last section beyond total distance', () => {
    expect(resolveCurrentSection(10, sections)?.id).toBe('sec-2');
  });

  it('returns null when there are no sections', () => {
    expect(resolveCurrentSection(1, [])).toBeNull();
  });

  it('excludes bypass sections from the cumulative-distance sum', () => {
    const withBypass: Section[] = [
      makeSection({ id: 'sec-1', officialNumber: 1 }),
      // A bypass sitting between sec-1 and sec-2, with its own distance —
      // if it were wrongly included in the sum, it would push sec-2's start
      // further out and this test's midpoint distance would resolve to sec-1.
      makeSection({ id: 'sec-1-bypass', officialNumber: 2, kind: 'bypass', relatedSectionId: 'sec-1' }),
      makeSection({ id: 'sec-2', officialNumber: 3 }),
    ];
    expect(resolveCurrentSection(1.5, withBypass)?.id).toBe('sec-2');
  });

  it('returns null when only bypass sections are present', () => {
    const onlyBypass: Section[] = [makeSection({ id: 'byp-1', officialNumber: 1, kind: 'bypass' })];
    expect(resolveCurrentSection(0.5, onlyBypass)).toBeNull();
  });

  it('orders by officialNumber, not array order', () => {
    const outOfOrder: Section[] = [
      makeSection({ id: 'sec-2', officialNumber: 2 }),
      makeSection({ id: 'sec-1', officialNumber: 1 }),
    ];
    expect(resolveCurrentSection(0.1, outOfOrder)?.id).toBe('sec-1');
  });
});

describe('computeCompletionPercentage', () => {
  it('computes a mid-trail percentage', () => {
    expect(computeCompletionPercentage(1.113, 2.226)).toBeCloseTo(50, 0);
  });

  it('clamps below zero to zero', () => {
    expect(computeCompletionPercentage(-1, 2.226)).toBe(0);
  });

  it('clamps above the total to 100', () => {
    expect(computeCompletionPercentage(10, 2.226)).toBe(100);
  });

  it('returns 0 for a zero-length trail', () => {
    expect(computeCompletionPercentage(1, 0)).toBe(0);
  });
});

describe('computeNavigationState', () => {
  it('reports on-trail near the line start', () => {
    const state = computeNavigationState(
      { latitude: 0, longitude: 0 },
      totalDistanceKm,
      straightLineGeometry,
      sections,
    );
    expect(state.isOffTrail).toBe(false);
    expect(state.distanceFromTrailMeters).toBeLessThan(1);
    expect(state.distanceAlongTrailKm).toBeCloseTo(0, 1);
    expect(state.currentSectionId).toBe('sec-1');
  });

  it('detects off-trail when far from the line', () => {
    const state = computeNavigationState(
      { latitude: 0.002, longitude: 0.01 }, // ~222m north of the line
      totalDistanceKm,
      straightLineGeometry,
      sections,
    );
    expect(state.isOffTrail).toBe(true);
    expect(state.distanceFromTrailMeters).toBeGreaterThan(50);
  });

  it('computes progress at the midpoint', () => {
    const state = computeNavigationState(
      { latitude: 0, longitude: 0.01 },
      totalDistanceKm,
      straightLineGeometry,
      sections,
    );
    expect(state.distanceAlongTrailKm).toBeCloseTo(totalDistanceKm / 2, 1);
    expect(state.completionPercentage).toBeCloseTo(50, 0);
    // Exactly on the section-1/section-2 boundary; resolveCurrentSection's
    // inclusive-lower-bound rule assigns boundary points to the earlier section.
    expect(state.currentSectionId).toBe('sec-1');
  });

  it('resolves the later section once clearly past the boundary', () => {
    const state = computeNavigationState(
      { latitude: 0, longitude: 0.015 },
      totalDistanceKm,
      straightLineGeometry,
      sections,
    );
    expect(state.currentSectionId).toBe('sec-2');
  });
});

describe('computeSectionRelativeProgress', () => {
  // A short section spanning only the first half of the equator test line
  // above (0,0) -> (0.01,0), ~1.113km — distinct from the whole-trail total
  // so a mix-up between section-relative and whole-trail progress would fail.
  const sectionGeometry: TrailGeometryShape = {
    type: 'LineString',
    coordinates: [
      [0, 0],
      [0.01, 0],
    ],
  };
  // Derived from the actual geometry, same as the app does, so it matches
  // turf's line-length calculation exactly rather than a hand-rounded constant.
  const sectionDistanceKm = lineStringLengthKm(sectionGeometry);

  it('reports zero progress at the section start', () => {
    const progress = computeSectionRelativeProgress({ latitude: 0, longitude: 0 }, sectionGeometry, sectionDistanceKm);
    expect(progress.distanceAlongSectionKm).toBeCloseTo(0, 1);
    expect(progress.completionPercentage).toBeCloseTo(0, 0);
    expect(progress.distanceRemainingKm).toBeCloseTo(sectionDistanceKm, 1);
  });

  it('reports full progress at the section end', () => {
    const progress = computeSectionRelativeProgress(
      { latitude: 0, longitude: 0.01 },
      sectionGeometry,
      sectionDistanceKm,
    );
    expect(progress.completionPercentage).toBeCloseTo(100, 0);
    expect(progress.distanceRemainingKm).toBeCloseTo(0, 1);
  });

  it('is scoped to the section, not the whole trail', () => {
    // Same coordinate used in the whole-trail midpoint test above, where
    // distanceAlongTrailKm ~= totalDistanceKm / 2 (~1.113km); against this
    // section alone (which ends exactly there) it should read as ~100%, not ~50%.
    const progress = computeSectionRelativeProgress(
      { latitude: 0, longitude: 0.01 },
      sectionGeometry,
      sectionDistanceKm,
    );
    expect(progress.completionPercentage).toBeCloseTo(100, 0);
  });

  it('does not exceed the section total when the nearest point is beyond it', () => {
    const progress = computeSectionRelativeProgress(
      { latitude: 0, longitude: 0.05 },
      sectionGeometry,
      sectionDistanceKm,
    );
    expect(progress.distanceAlongSectionKm).toBeLessThanOrEqual(sectionDistanceKm);
    expect(progress.distanceRemainingKm).toBe(0);
  });
});
