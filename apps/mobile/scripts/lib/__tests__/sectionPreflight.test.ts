import { classifyMainSectionPreflight } from '../sectionPreflight';

describe('classifyMainSectionPreflight', () => {
  it('never attempts OSM matching for a ferry section — expected absence, not a failure', () => {
    const result = classifyMainSectionPreflight('ferry', [], new Set());
    expect(result.attempt).toBe(false);
    if (!result.attempt) expect(result.disposition).toBe('expected_no_geometry_due_to_travel_mode');
  });

  it('never attempts OSM matching for a water_taxi section', () => {
    const result = classifyMainSectionPreflight('water_taxi', [], new Set());
    expect(result.attempt).toBe(false);
    if (!result.attempt) expect(result.disposition).toBe('expected_no_geometry_due_to_travel_mode');
  });

  it('attempts matching for an ordinary foot section with a healthy region', () => {
    const result = classifyMainSectionPreflight('foot', ['waikato'], new Set());
    expect(result.attempt).toBe(true);
  });

  it('attempts matching for a kayak section (kayak sections are main-route, not skipped)', () => {
    const result = classifyMainSectionPreflight('kayak', ['whanganui'], new Set());
    expect(result.attempt).toBe(true);
  });

  it('skips a section whose region already failed OSM validation, without attempting a match', () => {
    const result = classifyMainSectionPreflight('foot', ['canterbury'], new Set(['canterbury']));
    expect(result.attempt).toBe(false);
    if (!result.attempt) expect(result.disposition).toBe('source_region_failed');
  });

  it('skips when any one of multiple regions (a straddling section) failed', () => {
    const result = classifyMainSectionPreflight('foot', ['auckland', 'northland'], new Set(['northland']));
    expect(result.attempt).toBe(false);
    if (!result.attempt) expect(result.disposition).toBe('source_region_failed');
  });

  it('attempts matching when the section\'s region is healthy even if other unrelated regions failed', () => {
    const result = classifyMainSectionPreflight('foot', ['waikato'], new Set(['canterbury', 'whanganui']));
    expect(result.attempt).toBe(true);
  });

  it('travel mode takes precedence over region-failure status', () => {
    // A ferry section whose region also happens to have failed should still
    // report the travel-mode reason, not be conflated with a region failure.
    const result = classifyMainSectionPreflight('ferry', ['wellington'], new Set(['wellington']));
    expect(result.attempt).toBe(false);
    if (!result.attempt) expect(result.disposition).toBe('expected_no_geometry_due_to_travel_mode');
  });
});
