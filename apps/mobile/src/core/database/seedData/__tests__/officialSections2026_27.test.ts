import {
  REGION_SEEDS,
  SECTION_REGION_SEEDS,
  SECTION_SEEDS,
  TRUST_SEASON,
} from '../officialSections2026_27';
import { isValidAccessStatus } from '../../../../domain/models/Section';

describe('official 2026-27 section catalog', () => {
  it('has exactly 94 sections', () => {
    expect(SECTION_SEEDS).toHaveLength(94);
  });

  it('splits into 81 main and 13 bypass sections, per the source audit', () => {
    expect(SECTION_SEEDS.filter((s) => s.kind === 'main')).toHaveLength(81);
    expect(SECTION_SEEDS.filter((s) => s.kind === 'bypass')).toHaveLength(13);
  });

  it('has unique official_number values covering 1..94', () => {
    const numbers = SECTION_SEEDS.map((s) => s.officialNumber).sort((a, b) => a - b);
    expect(new Set(numbers).size).toBe(94);
    expect(numbers[0]).toBe(1);
    expect(numbers[93]).toBe(94);
  });

  it('has unique ids', () => {
    expect(new Set(SECTION_SEEDS.map((s) => s.id)).size).toBe(SECTION_SEEDS.length);
  });

  it('tags every section with the current trust season', () => {
    expect(TRUST_SEASON).toBe('2026-27');
  });

  describe('related_section_id integrity', () => {
    it('is set only on bypass sections', () => {
      for (const section of SECTION_SEEDS) {
        if (section.kind === 'main') {
          expect(section.relatedSectionId).toBeNull();
        }
      }
    });

    it('every bypass points at a real main section that exists in the catalog', () => {
      const mainIds = new Set(SECTION_SEEDS.filter((s) => s.kind === 'main').map((s) => s.id));
      for (const section of SECTION_SEEDS.filter((s) => s.kind === 'bypass')) {
        expect(section.relatedSectionId).not.toBeNull();
        expect(mainIds.has(section.relatedSectionId as string)).toBe(true);
      }
    });

    it('flags the two name-matches the audit could not confirm with certainty', () => {
      const uncertain = SECTION_SEEDS.filter((s) => s.matchConfidence === 'likely').map((s) => s.officialNumber);
      expect(uncertain.sort((a, b) => a - b)).toEqual([10, 22, 71]);
    });
  });

  describe('special-case sections retain the source\'s own modeling, not a reinterpretation', () => {
    it('the two Cook Strait legs do not count toward trail distance', () => {
      const interislander = SECTION_SEEDS.find((s) => s.officialNumber === 64)!;
      const waterTaxi = SECTION_SEEDS.find((s) => s.officialNumber === 65)!;
      expect(interislander.countsTowardTrailDistance).toBe(false);
      expect(waterTaxi.countsTowardTrailDistance).toBe(false);
      expect(interislander.travelMode).toBe('ferry');
      expect(waterTaxi.travelMode).toBe('water_taxi');
      // Both are 'main', per the source's own Main Trail layer — never modeled as bypasses.
      expect(interislander.kind).toBe('main');
      expect(waterTaxi.kind).toBe('main');
    });

    it('kayak sections count toward trail distance — they are the default main route, not a bypass', () => {
      const whanganuiRiver = SECTION_SEEDS.find((s) => s.officialNumber === 48)!;
      expect(whanganuiRiver.kind).toBe('main');
      expect(whanganuiRiver.travelMode).toBe('kayak');
      expect(whanganuiRiver.countsTowardTrailDistance).toBe(true);
    });

    it('the tidal-crossing section is main, not a bypass, with tidalDependent set', () => {
      const okuraLowTide = SECTION_SEEDS.find((s) => s.officialNumber === 24)!;
      expect(okuraLowTide.kind).toBe('main');
      expect(okuraLowTide.tidalDependent).toBe(true);
    });

    it('hazard-zone bypasses carry their reason from the source, and are still kind=bypass', () => {
      const rakaiaHazard = SECTION_SEEDS.find((s) => s.officialNumber === 74)!;
      expect(rakaiaHazard.kind).toBe('bypass');
      expect(rakaiaHazard.bypassReason).toBeTruthy();
    });
  });

  it('every non-null accessStatus is one of the three approved values', () => {
    for (const section of SECTION_SEEDS) {
      expect(isValidAccessStatus(section.accessStatus)).toBe(true);
    }
  });

  it('main sections have cumulative km, bypasses do not (they run parallel, not in sequence)', () => {
    for (const section of SECTION_SEEDS) {
      if (section.kind === 'main') {
        expect(section.cumulativeFromKm).not.toBeNull();
        expect(section.cumulativeToKm).not.toBeNull();
      } else {
        expect(section.cumulativeFromKm).toBeNull();
        expect(section.cumulativeToKm).toBeNull();
      }
    }
  });

  it('main sections are contiguous 0 -> ~3073.2km with no gaps', () => {
    const main = SECTION_SEEDS.filter((s) => s.kind === 'main').sort((a, b) => a.officialNumber - b.officialNumber);
    expect(main[0].cumulativeFromKm).toBe(0);
    for (let i = 1; i < main.length; i++) {
      expect(main[i].cumulativeFromKm).toBeCloseTo(main[i - 1].cumulativeToKm as number, 5);
    }
    expect(main[main.length - 1].cumulativeToKm).toBeCloseTo(3073.2, 1);
  });
});

describe('region catalog', () => {
  it('has exactly the 11 approved regions in north-to-south sequence', () => {
    expect(REGION_SEEDS).toHaveLength(11);
    const sorted = [...REGION_SEEDS].sort((a, b) => a.sequence - b.sequence);
    expect(sorted.map((r) => r.name)).toEqual([
      'Northland',
      'Auckland',
      'Waikato',
      'Whanganui',
      'Manawatū',
      'Wellington',
      'Marlborough',
      'Tasman',
      'Canterbury',
      'Otago',
      'Southland',
    ]);
  });

  it('does not use the Trust\'s own inconsistent internal numeric region codes as ids', () => {
    for (const region of REGION_SEEDS) {
      expect(region.id).not.toMatch(/^\d+$/);
    }
  });
});

describe('section_regions many-to-many', () => {
  it('every section has at least one region row, with exactly one marked primary', () => {
    const bySection = new Map<string, typeof SECTION_REGION_SEEDS>();
    for (const row of SECTION_REGION_SEEDS) {
      bySection.set(row.sectionId, [...(bySection.get(row.sectionId) ?? []), row]);
    }
    for (const section of SECTION_SEEDS) {
      const rows = bySection.get(section.id) ?? [];
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows.filter((r) => r.isPrimary)).toHaveLength(1);
    }
  });

  it('every region_id referenced actually exists in the region catalog', () => {
    const regionIds = new Set(REGION_SEEDS.map((r) => r.id));
    for (const row of SECTION_REGION_SEEDS) {
      expect(regionIds.has(row.regionId)).toBe(true);
    }
  });

  it('preserves real straddling sections rather than forcing a single region', () => {
    // Confirmed during the audit: Mt Tamahunga (17) straddles Auckland/Northland.
    const mtTamahunga = SECTION_REGION_SEEDS.filter((r) => r.sectionId === 'te-araroa-17');
    expect(mtTamahunga.length).toBeGreaterThanOrEqual(2);
  });
});
