import Database from 'better-sqlite3';
import {
  drizzle,
  type BetterSQLite3Database,
} from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as sqliteVec from 'sqlite-vec';
import * as schema from './schema.js';

export type AppDb = BetterSQLite3Database<typeof schema>;

export const MIGRATIONS_FOLDER = resolve(import.meta.dirname, '../../drizzle');

export interface DbHandle {
  sqlite: Database.Database;
  db: AppDb;
}

/** Opens the DB, loads sqlite-vec on this connection and runs migrations. */
export function openDatabase(path: string): DbHandle {
  if (path !== ':memory:')
    mkdirSync(dirname(resolve(path)), { recursive: true });
  const sqlite = new Database(path);
  sqliteVec.load(sqlite);
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { sqlite, db };
}
