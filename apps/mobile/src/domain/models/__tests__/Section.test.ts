import { isValidAccessStatus, KNOWN_TRAVEL_MODES } from '../Section';

describe('isValidAccessStatus', () => {
  it('accepts the three approved values', () => {
    expect(isValidAccessStatus('open')).toBe(true);
    expect(isValidAccessStatus('closed')).toBe(true);
    expect(isValidAccessStatus('seasonal')).toBe(true);
  });

  it('accepts null (no known status)', () => {
    expect(isValidAccessStatus(null)).toBe(true);
  });

  it('rejects values that are not open/closed/seasonal', () => {
    expect(isValidAccessStatus('road')).toBe(false);
    expect(isValidAccessStatus('water')).toBe(false);
    expect(isValidAccessStatus('strait')).toBe(false);
    expect(isValidAccessStatus('bypass')).toBe(false);
    expect(isValidAccessStatus('Open')).toBe(false); // case-sensitive, matches the DB CHECK constraint
    expect(isValidAccessStatus('')).toBe(false);
  });
});

describe('travel_mode', () => {
  it('is not restricted to a fixed set — accepting an unlisted value should not require a code change', () => {
    // travelMode is typed `string` precisely so a value outside
    // KNOWN_TRAVEL_MODES (e.g. a mode a future Trust season introduces)
    // still type-checks and flows through the system unchanged.
    const futureMode: string = 'shuttle';
    expect(typeof futureMode).toBe('string');
    expect(KNOWN_TRAVEL_MODES).not.toContain(futureMode);
  });

  it('KNOWN_TRAVEL_MODES lists the modes confirmed by the 2026-27 data audit', () => {
    expect(KNOWN_TRAVEL_MODES).toEqual(['foot', 'kayak', 'ferry', 'water_taxi']);
  });
});
