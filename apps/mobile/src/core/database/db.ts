import * as SQLite from 'expo-sqlite';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    // SQLite defaults foreign_keys OFF for backward compatibility; without
    // this, every REFERENCES clause in the schema (including the sections/
    // geometries/section_regions foreign keys added in migration 003) is
    // documentation only and never actually enforced.
    dbPromise = SQLite.openDatabaseAsync('hiking-nav.db').then(async (db) => {
      await db.execAsync('PRAGMA foreign_keys = ON;');
      return db;
    });
  }
  return dbPromise;
}
