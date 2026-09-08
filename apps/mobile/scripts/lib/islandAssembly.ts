import { haversineMeters } from './geoMath';
import type { Coord, IslandLine, Part } from './types';

/**
 * Coarse, independent geographic anchors used only to seed the direction of
 * the very first region in the chain (see below) — NOT sourced from the
 * Trust's data, just well-known public geography (a lighthouse and a town),
 * accurate to a few km, which is all this needs.
 */
const CAPE_REINGA: Coord = [172.6817, -34.4269];
const BLUFF: Coord = [168.3306, -46.6];

export interface RegionInput {
  regionId: string;
  /** This region's own stitched parts, already validated (see the existing per-region pipeline), NOT yet simplified. */
  parts: Part[];
  island: 'NI' | 'SI';
  /** North-to-south order, from regions.sequence (Phase 1). */
  sequence: number;
}

function firstCoordOf(parts: Part[]): Coord {
  return parts[0][0];
}
function lastCoordOf(parts: Part[]): Coord {
  const last = parts[parts.length - 1];
  return last[last.length - 1];
}

function reversedParts(parts: Part[]): Part[] {
  return [...parts].reverse().map((part) => [...part].reverse());
}

/**
 * Concatenates each region's parts, in region.sequence order, into one
 * IslandLine per island. Regions are never stitched to each other — every
 * region's own parts remain separate Part entries in the result, exactly
 * like the internal gaps the existing per-region stitcher already preserves.
 *
 * Orientation is resolved by **following the chain**, not by a single
 * global start/end check: each region's own stitched direction is
 * independently arbitrary (it inherits whichever direction Overpass
 * happened to return that region's first way in), so two adjacent regions
 * can easily be internally reversed relative to each other even when their
 * sequence order is correct.
 *
 * For each region after the first, whichever of its own two endpoints is
 * closer to the end of the line assembled so far becomes its effective
 * start (reversing its parts if that's its own last point).
 *
 * The very first region has no preceding neighbor — it is instead oriented
 * against its own *next* region (whichever of its own endpoints is nearer
 * to the next region's nearest endpoint becomes its effective end). A fixed
 * geographic anchor (Cape Reinga / Bluff) is used only as a last resort, for
 * the degenerate single-region-island case. A real bug was found and fixed
 * here: anchoring the first region directly against Bluff (~700km from
 * Marlborough, the South Island's own first region) was too weak a signal —
 * it produced a reversed Marlborough line, corrupting sections 66-68's
 * matching even though each individual boundary matched within threshold.
 */
export function assembleIslandLine(regions: RegionInput[], island: 'NI' | 'SI'): IslandLine {
  const ordered = regions.filter((r) => r.island === island).sort((a, b) => a.sequence - b.sequence);

  const parts: Part[] = [];
  const partRegionIds: string[] = [];

  const anchor = island === 'NI' ? CAPE_REINGA : BLUFF;

  ordered.forEach((region, index) => {
    let regionParts = region.parts;

    if (index === 0) {
      if (ordered.length > 1) {
        const next = ordered[1];
        const ownFirst = firstCoordOf(regionParts);
        const ownLast = lastCoordOf(regionParts);
        const nextFirst = firstCoordOf(next.parts);
        const nextLast = lastCoordOf(next.parts);
        const bestIfNotReversed = Math.min(haversineMeters(ownLast, nextFirst), haversineMeters(ownLast, nextLast));
        const bestIfReversed = Math.min(haversineMeters(ownFirst, nextFirst), haversineMeters(ownFirst, nextLast));
        if (bestIfReversed < bestIfNotReversed) {
          regionParts = reversedParts(regionParts);
        }
      } else {
        // Degenerate case: only one region on this island at all — nothing
        // local to compare against, fall back to the fixed anchor.
        const distFromFirst = haversineMeters(anchor, firstCoordOf(regionParts));
        const distFromLast = haversineMeters(anchor, lastCoordOf(regionParts));
        if (distFromLast < distFromFirst) {
          regionParts = reversedParts(regionParts);
        }
      }
    } else {
      const chainEnd = parts[parts.length - 1][parts[parts.length - 1].length - 1];
      const distToOwnFirst = haversineMeters(chainEnd, firstCoordOf(regionParts));
      const distToOwnLast = haversineMeters(chainEnd, lastCoordOf(regionParts));
      if (distToOwnLast < distToOwnFirst) {
        regionParts = reversedParts(regionParts);
      }
    }

    // Copy (never reference the caller's own arrays) so this function never
    // mutates its input — necessary for safe re-calling on the same
    // RegionInput[] (idempotency).
    for (const part of regionParts) {
      parts.push([...part]);
      partRegionIds.push(region.regionId);
    }
  });

  return { island, parts, partRegionIds };
}
