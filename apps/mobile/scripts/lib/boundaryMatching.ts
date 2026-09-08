import { haversineMeters, nearestPointOnPart, partLengthKm } from './geoMath';
import type { BoundaryMatchResult, BoundaryRole, BypassCandidate, Coord, IslandLine, Part, ResolvedCut } from './types';

export interface PartsNearestResult {
  cut: ResolvedCut;
  distanceMeters: number;
  /** Cumulative distance from the very start of `parts[0]`, summing whole preceding parts plus the within-part position. Gaps between parts add nothing, matching this app's existing MultiLineString distance convention (see shared/utils/geo.ts). */
  distanceAlongKm: number;
}

/** True when the end cut precedes the start cut — reversed traversal order. */
export function isReversedOrder(startCut: ResolvedCut, endCut: ResolvedCut): boolean {
  if (startCut.partIndex !== endCut.partIndex) return startCut.partIndex > endCut.partIndex;
  return startCut.segmentIndex > endCut.segmentIndex;
}

/** Core search primitive: nearest point across an ordered array of Parts, picking the globally closest regardless of which part it falls in. Shared by both island (main) and candidate (bypass) matching — neither needs its own copy of this loop. */
export function findNearestOnParts(parts: Part[], target: Coord): PartsNearestResult | null {
  let best: PartsNearestResult | null = null;
  let cumulativeBeforePart = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.length >= 2) {
      const match = nearestPointOnPart(part, target);
      if (!best || match.distanceMeters < best.distanceMeters) {
        best = {
          cut: { partIndex: i, segmentIndex: match.segmentIndex, coordinate: match.coordinate },
          distanceMeters: match.distanceMeters,
          distanceAlongKm: cumulativeBeforePart + match.distanceAlongPartKm,
        };
      }
    }
    cumulativeBeforePart += partLengthKm(part);
  }
  return best;
}

export interface InternalBoundaryResolution {
  /** Report-safe result — never carries the Trust anchor coordinate, only OSM-derived facts. */
  report: BoundaryMatchResult;
  /** Internal only, used by slicing; not written to the validation report. */
  cut: ResolvedCut | null;
}

function unmatched(officialNumber: number, role: BoundaryRole): InternalBoundaryResolution {
  return { report: { officialNumber, role, matched: false }, cut: null };
}

function matchOneOnIsland(
  island: IslandLine,
  target: Coord,
  officialNumber: number,
  role: BoundaryRole,
  thresholdMeters: number,
): InternalBoundaryResolution {
  const found = findNearestOnParts(island.parts, target);
  if (!found || found.distanceMeters > thresholdMeters) {
    return unmatched(officialNumber, role);
  }
  return {
    report: {
      officialNumber,
      role,
      matched: true,
      matchedCoordinate: found.cut.coordinate,
      distanceMeters: found.distanceMeters,
      distanceAlongIslandKm: found.distanceAlongKm,
      regionId: island.partRegionIds[found.cut.partIndex],
    },
    cut: found.cut,
  };
}

export interface MainSectionInput {
  officialNumber: number;
  trustStart: Coord;
  trustEnd: Coord;
}

export interface ResolveMainBoundariesOptions {
  thresholdMeters: number;
  /** How close two adjacent sections' own Trust GPX endpoints must be to be treated as one physical boundary. Independent of, and much smaller than, thresholdMeters. */
  sharedBoundaryToleranceMeters: number;
  /**
   * The full official_number sequence of every kind='main' section in the
   * catalog (not just the ones being attempted this run), sorted ascending.
   * Used to tell a *true* catalog neighbor (differs only by skipped bypass
   * numbers, which never appear here) from two sections that merely ended up
   * array-adjacent because something between them (e.g. a source_region_failed
   * section) was excluded from `sectionsInOrder`. Without this, a pair like
   * [42, 55] — 16 sections apart in the real catalog — would be wrongly
   * treated as sharing a boundary and flagged as "inconsistent" when they
   * were never expected to be physically adjacent at all.
   */
  allMainOfficialNumbers: number[];
}

export interface SharedBoundaryFlag {
  betweenOfficialNumbers: [number, number];
  distanceMeters: number;
}

export interface ResolvedMainBoundaries {
  startCuts: Map<number, InternalBoundaryResolution>;
  endCuts: Map<number, InternalBoundaryResolution>;
  sharedBoundaryFlags: SharedBoundaryFlag[];
}

function isTrueCatalogAdjacent(a: number, b: number, allMainOfficialNumbers: number[]): boolean {
  return !allMainOfficialNumbers.some((n) => n > a && n < b);
}

/**
 * Resolves every main section's start/end boundary.
 *
 * True catalog-adjacent sections share one physical interior boundary,
 * resolved once against OSM and reused for both neighbors — UNLESS the two
 * sections' own Trust GPX endpoints disagree beyond
 * `sharedBoundaryToleranceMeters` (checked in both the expected orientation
 * AND, before giving up, the three other start/end pairings — see below),
 * in which case nothing is silently merged: the pair is flagged and each
 * side is matched independently instead.
 *
 * Two array-adjacent sections that are NOT true catalog neighbors (because
 * something between them was excluded this run) are never compared at all —
 * each is treated as an independent chain edge, like the very first/last
 * section, rather than producing a misleading "inconsistency".
 *
 * Orientation check (found via the real #58 case: a section's own GPX file
 * can be recorded in the opposite direction to its SOBO neighbors — e.g.
 * section 58's file runs end-to-start relative to 57 and 59, evidenced
 * directly by 57's end == 58's own end, and 58's own start == 59's start).
 * When the expected pairing (prev end vs next start) misses tolerance, the
 * other three pairings are tried; if exactly the "both ends" pairing
 * matches, the next section's own start/end are used swapped for matching
 * purposes — this is not a fabrication, it's using the same real coordinates
 * in the direction the evidence says the hiker actually walks them.
 *
 * `sectionsInOrder` must already be sorted by officialNumber and contain
 * only kind='main' sections.
 */
export function resolveMainSectionBoundaries(
  island: IslandLine,
  sectionsInOrder: MainSectionInput[],
  options: ResolveMainBoundariesOptions,
): ResolvedMainBoundaries {
  const startCuts = new Map<number, InternalBoundaryResolution>();
  const endCuts = new Map<number, InternalBoundaryResolution>();
  const sharedBoundaryFlags: SharedBoundaryFlag[] = [];

  // effectiveEnd[i]: the coordinate to use as section i's "downstream" end
  // for chain purposes, corrected for orientation as evidence is found.
  const effectiveEnd = new Map<number, Coord>();

  for (let i = 0; i < sectionsInOrder.length; i++) {
    const section = sectionsInOrder[i];

    if (i === 0) {
      startCuts.set(
        section.officialNumber,
        matchOneOnIsland(island, section.trustStart, section.officialNumber, 'start', options.thresholdMeters),
      );
      effectiveEnd.set(section.officialNumber, section.trustEnd);
    }

    if (i === sectionsInOrder.length - 1) {
      endCuts.set(
        section.officialNumber,
        matchOneOnIsland(island, effectiveEnd.get(section.officialNumber)!, section.officialNumber, 'end', options.thresholdMeters),
      );
      continue;
    }

    const next = sectionsInOrder[i + 1];
    const myEnd = effectiveEnd.get(section.officialNumber)!;

    if (!isTrueCatalogAdjacent(section.officialNumber, next.officialNumber, options.allMainOfficialNumbers)) {
      // Something was excluded between them — not a real chain link. Resolve
      // both sides independently, exactly like a chain start/end, no flag.
      endCuts.set(
        section.officialNumber,
        matchOneOnIsland(island, myEnd, section.officialNumber, 'end', options.thresholdMeters),
      );
      startCuts.set(
        next.officialNumber,
        matchOneOnIsland(island, next.trustStart, next.officialNumber, 'start', options.thresholdMeters),
      );
      effectiveEnd.set(next.officialNumber, next.trustEnd);
      continue;
    }

    const distEndToNextStart = haversineMeters(myEnd, next.trustStart);
    const distEndToNextEnd = haversineMeters(myEnd, next.trustEnd);
    const tol = options.sharedBoundaryToleranceMeters;

    let sharedPoint: Coord | null = null;
    let nextEffectiveEnd: Coord = next.trustEnd;
    if (distEndToNextStart <= tol) {
      sharedPoint = myEnd; // normal orientation
    } else if (distEndToNextEnd <= tol) {
      // `next`'s own file is reversed relative to the chain — its real
      // "downstream" end is its own recorded start.
      sharedPoint = myEnd;
      nextEffectiveEnd = next.trustStart;
    }

    if (sharedPoint) {
      const shared = matchOneOnIsland(island, sharedPoint, section.officialNumber, 'end', options.thresholdMeters);
      endCuts.set(section.officialNumber, shared);
      startCuts.set(next.officialNumber, {
        report: { ...shared.report, officialNumber: next.officialNumber, role: 'start' },
        cut: shared.cut,
      });
      effectiveEnd.set(next.officialNumber, nextEffectiveEnd);
    } else {
      sharedBoundaryFlags.push({
        betweenOfficialNumbers: [section.officialNumber, next.officialNumber],
        distanceMeters: Math.min(distEndToNextStart, distEndToNextEnd),
      });
      endCuts.set(
        section.officialNumber,
        matchOneOnIsland(island, myEnd, section.officialNumber, 'end', options.thresholdMeters),
      );
      startCuts.set(
        next.officialNumber,
        matchOneOnIsland(island, next.trustStart, next.officialNumber, 'start', options.thresholdMeters),
      );
      effectiveEnd.set(next.officialNumber, next.trustEnd);
    }
  }

  return { startCuts, endCuts, sharedBoundaryFlags };
}

export interface BypassSectionInput {
  officialNumber: number;
  trustStart: Coord;
  trustEnd: Coord;
}

export interface BypassMatchResult {
  startReport: BoundaryMatchResult;
  endReport: BoundaryMatchResult;
  startCut: ResolvedCut | null;
  endCut: ResolvedCut | null;
  matchedCandidateId: string | null;
}

/**
 * Matches a bypass section against OSM alternate-relation candidates only —
 * never the main route. Because more than one candidate can exist in the
 * same rough area, this isn't "nearest single point": a candidate is only
 * accepted if BOTH of the section's boundaries clear the threshold against
 * it, and among candidates that qualify, the one minimizing the combined
 * (start + end) distance is selected. This is what prevents a bypass from
 * being matched onto a different, nearby bypass's line.
 */
export function matchBypassSection(
  section: BypassSectionInput,
  candidates: BypassCandidate[],
  thresholdMeters: number,
): BypassMatchResult {
  let best: {
    candidate: BypassCandidate;
    startFound: PartsNearestResult;
    endFound: PartsNearestResult;
    score: number;
  } | null = null;

  for (const originalCandidate of candidates) {
    let candidate = originalCandidate;
    let startFound = findNearestOnParts(candidate.parts, section.trustStart);
    let endFound = findNearestOnParts(candidate.parts, section.trustEnd);
    if (!startFound || !endFound) continue;
    if (startFound.distanceMeters > thresholdMeters || endFound.distanceMeters > thresholdMeters) continue;

    if (isReversedOrder(startFound.cut, endFound.cut)) {
      // Confirmed root cause of an earlier bug (bypass #22): an independent
      // OSM alternate-relation candidate can be authored in the opposite
      // direction to the Trust's SOBO convention. This is not a fabrication —
      // it's the same real OSM coordinates, just traversed the other way —
      // so if reversing fixes the ordering, use the reversed candidate.
      // If it doesn't, this is left as a genuine ambiguity for the caller's
      // length/interval checks to flag, not silently forced through.
      const reversed: BypassCandidate = {
        ...candidate,
        parts: [...candidate.parts].reverse().map((p) => [...p].reverse()),
      };
      const reversedStart = findNearestOnParts(reversed.parts, section.trustStart);
      const reversedEnd = findNearestOnParts(reversed.parts, section.trustEnd);
      if (
        reversedStart &&
        reversedEnd &&
        reversedStart.distanceMeters <= thresholdMeters &&
        reversedEnd.distanceMeters <= thresholdMeters &&
        !isReversedOrder(reversedStart.cut, reversedEnd.cut)
      ) {
        candidate = reversed;
        startFound = reversedStart;
        endFound = reversedEnd;
      }
    }

    const score = startFound.distanceMeters + endFound.distanceMeters;
    if (!best || score < best.score) {
      best = { candidate, startFound, endFound, score };
    }
  }

  if (!best) {
    return {
      startReport: { officialNumber: section.officialNumber, role: 'start', matched: false },
      endReport: { officialNumber: section.officialNumber, role: 'end', matched: false },
      startCut: null,
      endCut: null,
      matchedCandidateId: null,
    };
  }

  return {
    startReport: {
      officialNumber: section.officialNumber,
      role: 'start',
      matched: true,
      matchedCoordinate: best.startFound.cut.coordinate,
      distanceMeters: best.startFound.distanceMeters,
      distanceAlongIslandKm: best.startFound.distanceAlongKm,
      regionId: best.candidate.id,
    },
    endReport: {
      officialNumber: section.officialNumber,
      role: 'end',
      matched: true,
      matchedCoordinate: best.endFound.cut.coordinate,
      distanceMeters: best.endFound.distanceMeters,
      distanceAlongIslandKm: best.endFound.distanceAlongKm,
      regionId: best.candidate.id,
    },
    startCut: best.startFound.cut,
    endCut: best.endFound.cut,
    matchedCandidateId: best.candidate.id,
  };
}
