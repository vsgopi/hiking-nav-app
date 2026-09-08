import { parseGpxBoundary } from '../trustBoundaries';

describe('parseGpxBoundary', () => {
  it('extracts the first and last trkpt as [lon, lat] tuples', () => {
    const xml = `<?xml version="1.0"?>
<gpx><trk><trkseg>
  <trkpt lon="172.67759149866268" lat="-34.426698783755086"><ele>148.9</ele></trkpt>
  <trkpt lon="172.68" lat="-34.43"><ele>150.1</ele></trkpt>
  <trkpt lon="173.1572509960727" lat="-35.15939200692895"><ele>10.2</ele></trkpt>
</trkseg></trk></gpx>`;
    const { start, end } = parseGpxBoundary(xml);
    expect(start).toEqual([172.67759149866268, -34.426698783755086]);
    expect(end).toEqual([173.1572509960727, -35.15939200692895]);
  });

  it('throws on a file with no trkpt elements, rather than returning a fabricated boundary', () => {
    expect(() => parseGpxBoundary('<gpx><trk><trkseg></trkseg></trk></gpx>')).toThrow();
  });

  it('handles a single-point file by using it as both start and end', () => {
    const xml = '<gpx><trk><trkseg><trkpt lon="175.0" lat="-40.0"/></trkseg></trk></gpx>';
    const { start, end } = parseGpxBoundary(xml);
    expect(start).toEqual([175.0, -40.0]);
    expect(end).toEqual([175.0, -40.0]);
  });
});
