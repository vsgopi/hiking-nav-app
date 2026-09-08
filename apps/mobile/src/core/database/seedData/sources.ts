import type { Source } from '../../../domain/models/Source';

export const OSM_SOURCE_ID = 'osm';
export const TRUST_SOURCE_ID = 'ta-trust-2026-27';

/**
 * OSM's ODbL license is a well-known, already-usable open license — no
 * per-project confirmation step needed, so redistribution_status is
 * 'allowed' from the start.
 *
 * The Trust source covers both the Section Routes GPX and the Google Earth
 * KMZ from the same 2026-27 season download page: same publisher, same
 * season, no evidence either file carries different terms from the other.
 * redistribution_status MUST stay 'pending' — the license variant (the GPX's
 * own metadata says only "Creative Commons 4.0 New Zealand", no specific
 * variant) and whether app redistribution/commercial use is covered were not
 * found stated anywhere on teararoa.org.nz during the data audit. Do not
 * flip this to 'allowed' without written confirmation from the Trust.
 */
export const SOURCE_SEEDS: Source[] = [
  {
    id: OSM_SOURCE_ID,
    name: 'OpenStreetMap contributors',
    attributionText: '© OpenStreetMap contributors (openstreetmap.org)',
    license: 'ODbL 1.0',
    licenseConfirmed: true,
    redistributionStatus: 'allowed',
    confirmedBy: null,
    confirmedAt: null,
    url: 'https://www.openstreetmap.org/copyright',
    retrievedAt: '2026-08-27',
  },
  {
    id: TRUST_SOURCE_ID,
    name: 'Te Araroa Trust — 2026-27 season (Section Routes GPX + Google Earth KMZ)',
    attributionText: 'Te Araroa Trust (teararoa.org.nz)',
    license: 'Creative Commons 4.0 New Zealand (exact variant and redistribution terms unconfirmed)',
    licenseConfirmed: false,
    redistributionStatus: 'pending',
    confirmedBy: null,
    confirmedAt: null,
    url: 'https://www.teararoa.org.nz/notes-and-maps/',
    retrievedAt: '2026-06-09',
  },
];
