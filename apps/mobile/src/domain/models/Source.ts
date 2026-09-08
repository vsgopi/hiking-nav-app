/**
 * A single source of imported data (e.g. OpenStreetMap, or one season's Te
 * Araroa Trust download). Every row in a content table (sections, geometries)
 * points at exactly one Source, so a table can mix rows from multiple
 * providers without losing track of which license governs which row.
 */
export type RedistributionStatus = 'pending' | 'allowed' | 'not_allowed';

export interface Source {
  id: string;
  name: string;
  attributionText: string;
  license: string;
  licenseConfirmed: boolean;
  /**
   * Whether this source's content may be shown in production.
   * Defaults to 'pending' for anything not already known to be open-licensed —
   * never assume a source may be redistributed just because it was imported.
   */
  redistributionStatus: RedistributionStatus;
  confirmedBy: string | null;
  confirmedAt: string | null;
  url: string | null;
  retrievedAt: string | null;
}
