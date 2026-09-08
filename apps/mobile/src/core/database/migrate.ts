import type { SQLiteDatabase } from 'expo-sqlite';
import * as migration001 from './migrations/001_init';
import * as migration002 from './migrations/002_te_araroa_kind';
import * as migration003 from './migrations/003_sections_foundation';

const MIGRATIONS: { version: number; sql: string }[] = [
  { version: migration001.version, sql: migration001.sql },
  { version: migration002.version, sql: migration002.sql },
  { version: migration003.version, sql: migration003.sql },
];

export async function runMigrations(db: SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let currentVersion = row?.user_version ?? 0;

  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) {
      await db.execAsync(migration.sql);
      await db.execAsync(`PRAGMA user_version = ${migration.version}`);
      currentVersion = migration.version;
    }
  }
}
