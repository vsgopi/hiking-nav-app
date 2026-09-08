export type Island = 'NI' | 'SI';

/**
 * Grouping/metadata only — not a navigable unit. The primary navigation unit
 * is Section; a Section belongs to one or more Regions via section_regions
 * (a handful of official sections straddle two regions).
 */
export interface Region {
  id: string;
  trailId: string;
  name: string;
  sequence: number;
  island: Island;
}
