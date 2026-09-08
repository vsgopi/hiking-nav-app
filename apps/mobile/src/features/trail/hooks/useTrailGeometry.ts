import { useEffect, useState } from 'react';
import { useAppServices } from '../../../app/providers/AppProviders';
import type { Trail } from '../../../domain/models/Trail';
import type { TrailGeometryShape } from '../../../domain/models/TrailGeometry';
import type { Section } from '../../../domain/models/Section';

export type TrailDataState =
  | { status: 'loading' }
  | { status: 'error'; errorMessage: string }
  | {
      status: 'ready';
      trail: Trail;
      sections: Section[];
      /** Whole-trail geometry, or null if not yet ingested / not license-cleared for this build. */
      geometry: TrailGeometryShape | null;
      bypassGeometries: TrailGeometryShape[];
    };

export function useTrailGeometry(): TrailDataState {
  const { trailRepository } = useAppServices();
  const [state, setState] = useState<TrailDataState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [trail, sections, mainGeometry, bypassGeometries] = await Promise.all([
          trailRepository.getTrail(),
          trailRepository.getSections(),
          trailRepository.getMainTrailGeometry(),
          trailRepository.getBypassGeometries(),
        ]);
        if (cancelled) return;
        if (!trail) {
          setState({ status: 'error', errorMessage: 'No trail data available locally.' });
          return;
        }
        setState({
          status: 'ready',
          trail,
          sections,
          geometry: mainGeometry?.geometry ?? null,
          bypassGeometries: bypassGeometries.map((g) => g.geometry),
        });
      } catch (error) {
        if (!cancelled) {
          setState({
            status: 'error',
            errorMessage: error instanceof Error ? error.message : 'Failed to load trail data',
          });
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [trailRepository]);

  return state;
}
