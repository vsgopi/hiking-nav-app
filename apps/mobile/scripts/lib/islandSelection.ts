import { REGION_SEEDS, SECTION_REGION_SEEDS } from '../../src/core/database/seedData/officialSections2026_27';
import { findNearestOnParts } from './boundaryMatching';
import type { Coord, Island, IslandLine } from './types';

const REGION_ISLAND = new Map(REGION_SEEDS.map((r) => [r.id, r.island]));

/**
 * Deterministic island lookup from Phase 1's already-approved metadata
 * (section_regions -> regions.island) — never a geometric/latitude
 * heuristic. Replaces the coarse `latitude > -41.4` cutoff that
 * misclassified the Marlborough Sounds area (sections 66-68) as North
 * Island. Returns null only when a section's own regions genuinely span
 * both islands (not expected to occur in practice, but handled rather than
 * assumed away) or has no region metadata at all.
 */
export function determineIslandFromMetadata(sectionId: string): Island | null {
  const rows = SECTION_REGION_SEEDS.filter((r) => r.sectionId === sectionId);
  if (rows.length === 0) return null;
  const islands = new Set(rows.map((r) => REGION_ISLAND.get(r.regionId)).filter((i): i is Island => Boolean(i)));
  if (islands.size === 1) return [...islands][0];
  return null; // ambiguous: no metadata, or spans regions on different islands
}

export interface AmbiguousIslandResolution {
  island: Island | null;
  /** Populated only when metadata was ambiguous and a geometric fallback was attempted. */
  triedBothIslands: boolean;
  niDistanceMeters?: number;
  siDistanceMeters?: number;
}

/**
 * Fallback for the (not currently expected, but handled) case where Phase 1
 * metadata alone can't determine a section's island: try matching a single
 * reference point against BOTH island assemblies and use the existing
 * matching safeguards (distance threshold) to decide — never guess from
 * latitude. Only selects an island when exactly one side produces a
 * confident, unambiguous within-threshold result; otherwise reports the
 * ambiguity rather than picking arbitrarily.
 */
export function resolveAmbiguousIsland(
  referencePoint: Coord,
  niLine: IslandLine,
  siLine: IslandLine,
  thresholdMeters: number,
): AmbiguousIslandResolution {
  const niMatch = findNearestOnParts(niLine.parts, referencePoint);
  const siMatch = findNearestOnParts(siLine.parts, referencePoint);
  const niOk = niMatch !== null && niMatch.distanceMeters <= thresholdMeters;
  const siOk = siMatch !== null && siMatch.distanceMeters <= thresholdMeters;

  if (niOk && !siOk) return { island: 'NI', triedBothIslands: true, niDistanceMeters: niMatch!.distanceMeters, siDistanceMeters: siMatch?.distanceMeters };
  if (siOk && !niOk) return { island: 'SI', triedBothIslands: true, niDistanceMeters: niMatch?.distanceMeters, siDistanceMeters: siMatch!.distanceMeters };
  // Neither side is confidently within threshold, or both are (genuinely
  // ambiguous) — report rather than guess.
  return {
    island: null,
    triedBothIslands: true,
    niDistanceMeters: niMatch?.distanceMeters,
    siDistanceMeters: siMatch?.distanceMeters,
  };
}
