import type { SQLiteDatabase } from 'expo-sqlite';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { env } from '../config/env';
import { getDatabase } from '../../core/database/db';
import { runMigrations } from '../../core/database/migrate';
import { seedTrailDataIfNeeded } from '../../core/database/seed';
import { locationService, type LocationService } from '../../core/location/LocationService';
import { logger } from '../../core/logging/logger';
import { SqliteTrailRepository } from '../../domain/repositories/SqliteTrailRepository';
import type { TrailRepository } from '../../domain/repositories/TrailRepository';
import { ErrorView } from '../../shared/components/ErrorView';
import { LoadingView } from '../../shared/components/LoadingView';

interface AppServices {
  trailRepository: TrailRepository;
  locationService: LocationService;
}

const AppServicesContext = createContext<AppServices | null>(null);

export function useAppServices(): AppServices {
  const ctx = useContext(AppServicesContext);
  if (!ctx) {
    throw new Error('useAppServices must be used within AppProviders');
  }
  return ctx;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [services, setServices] = useState<AppServices | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const db: SQLiteDatabase = await getDatabase();
        await runMigrations(db);
        await seedTrailDataIfNeeded(db);
        if (cancelled) return;
        setServices({
          // allowUnconfirmedSources is __DEV__-derived and never true in a
          // production build — see env.ts and domain/repositories/licenseGate.ts.
          trailRepository: new SqliteTrailRepository(db, env.allowUnconfirmedSources),
          locationService,
        });
      } catch (err) {
        logger.error('App bootstrap failed', err);
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error('Bootstrap failed'));
        }
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <ErrorView message="Could not start the app. Please restart." detail={error.message} />;
  }

  if (!services) {
    return <LoadingView label="Preparing offline trail data…" />;
  }

  return <AppServicesContext.Provider value={services}>{children}</AppServicesContext.Provider>;
}
