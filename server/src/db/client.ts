import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { config } from '../config.js';

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(here, 'schema.sql');

/**
 * Open SQLite, apply the durability/concurrency pragmas, and ensure the
 * complete schema (including FTS5 triggers) exists.
 */
export function createDatabase(dbPath: string): Database.Database {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(resolve(dbPath)), { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(readFileSync(schemaPath, 'utf8'));
  return db;
}

let instance: Database.Database | undefined;

/** Lazily create the process-wide database using the validated DB_PATH. */
export function getDatabase(): Database.Database {
  if (!instance) {
    instance = createDatabase(config.DB_PATH);
  }
  return instance;
}

export function closeDatabase(): void {
  if (!instance) return;
  instance.close();
  instance = undefined;
}
