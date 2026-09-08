import { useEffect, useState } from 'react';
import { useAppServices } from '../../../app/providers/AppProviders';
import type { TrailGeometryShape } from '../../../domain/models/TrailGeometry';

/** Fetches the current section's own geometry for map highlighting, keyed on sectionId. */
export function useCurrentSectionGeometry(sectionId: string | null): TrailGeometryShape | null {
  const { trailRepository } = useAppServices();
  const [geometry, setGeometry] = useState<TrailGeometryShape | null>(null);

  useEffect(() => {
    if (!sectionId) return;
    let cancelled = false;

    trailRepository.getSectionGeometry(sectionId).then((result) => {
      if (!cancelled) {
        setGeometry(result?.geometry ?? null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [sectionId, trailRepository]);

  // Reported directly (not via effect-triggered setState) so a null sectionId
  // never renders a stale geometry from a previously selected section.
  return sectionId ? geometry : null;
}
