export type PoiType =
  | 'hut'
  | 'campsite'
  | 'water'
  | 'food'
  | 'grocery'
  | 'toilet'
  | 'transport'
  | 'medical'
  | 'other';

export interface Poi {
  id: string;
  trailId: string;
  sectionId: string;
  type: PoiType;
  name: string;
  latitude: number;
  longitude: number;
  description: string;
  facilities: string[];
  version: number;
}
