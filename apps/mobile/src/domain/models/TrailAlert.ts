import type { GeoLineString } from './TrailGeometry';

export type AlertSeverity = 'informational' | 'warning' | 'critical';
export type AlertStatus = 'active' | 'expired' | 'disabled';

export interface TrailAlert {
  id: string;
  trailId: string;
  sectionId: string | null;
  severity: AlertSeverity;
  title: string;
  description: string;
  geometry: GeoLineString | null;
  validFrom: string;
  validUntil: string | null;
  status: AlertStatus;
}
