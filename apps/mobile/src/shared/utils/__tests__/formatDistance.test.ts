import { formatDistanceFromTrail } from '../formatDistance';

describe('formatDistanceFromTrail', () => {
  it('formats sub-km distances as whole meters', () => {
    expect(formatDistanceFromTrail(42)).toBe('42m');
    expect(formatDistanceFromTrail(999)).toBe('999m');
  });

  it('formats distances at and above 1000m as kilometers', () => {
    expect(formatDistanceFromTrail(1000)).toBe('1.0km');
    expect(formatDistanceFromTrail(1500)).toBe('1.5km');
    expect(formatDistanceFromTrail(11421483)).toBe('11421.5km');
  });
});
