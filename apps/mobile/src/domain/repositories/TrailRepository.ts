import type { Trail } from '../models/Trail';
import type { Region } from '../models/Region';
import type { Section } from '../models/Section';
import type { Geometry } from '../models/TrailGeometry';

export interface TrailRepository {
  getTrail(): Promise<Trail | null>;
  /** All sections (both kind), Trust-authored fields redacted per the license gate. Ordered by official_number. */
  getSections(): Promise<Section[]>;
  getSection(id: string): Promise<Section | null>;
  getRegions(): Promise<Region[]>;
  /** A section's region(s) — most sections have one, a few straddle two. */
  getRegionsForSection(sectionId: string): Promise<Region[]>;
  /** Whole-trail convenience geometry (section_id IS NULL), used for GPS projection/progress. Null if not ingested, or if its source isn't license-cleared. */
  getMainTrailGeometry(): Promise<Geometry | null>;
  getSectionGeometry(sectionId: string): Promise<Geometry | null>;
  /** Geometry belonging to bypass-kind sections. Each entry gated independently by its own source. */
  getBypassGeometries(): Promise<Geometry[]>;
}
