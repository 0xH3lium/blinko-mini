import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { config } from '../config.js';

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(here, 'schema.sql');

const BUCKET_OPTIONS = {
  idea: 'A raw spark, hypothesis, or possible direction worth exploring.',
  memory: 'Durable personal knowledge or a lasting fact to keep verbatim.',
  reminder: 'A concrete thing the owner must do at a specific time.',
  question: 'An open question that still needs a real answer.',
  reference: 'An external source, article, quote, or link worth keeping.',
  noise: 'Low-value chatter with no lasting action or insight.',
};

const DEFAULT_HEADS = [
  {
    id: 'head-bucket',
    name: 'bucket',
    primitive: 'choice',
    instructions: 'Route this capture into exactly one bucket using the sharpest matching criterion.',
    config: { options: Object.entries(BUCKET_OPTIONS).map(([value, description]) => ({ value, description })) },
    entropyThreshold: 0.55,
    isSystem: 1,
    sortOrder: 0,
  },
  {
    id: 'head-leverage',
    name: 'leverage',
    primitive: 'score',
    instructions: 'How much leverage does this capture create?',
    config: {
      min: 0,
      max: 3,
      rubric: {
        0: 'trivial noise with no reusable consequence',
        1: 'minor useful note with limited reach',
        2: 'strong insight or reusable principle',
        3: 'high-leverage mechanism or breakthrough',
      },
    },
    entropyThreshold: 0.55,
    isSystem: 1,
    sortOrder: 1,
  },
  {
    id: 'head-actionable',
    name: 'actionable',
    primitive: 'noul',
    instructions: 'Does this capture describe or imply a concrete next action the owner should execute?',
    config: {},
    entropyThreshold: 0.55,
    isSystem: 0,
    sortOrder: 2,
  },
  {
    id: 'head-falsifiable',
    name: 'falsifiable',
    primitive: 'noul',
    instructions: 'Does this text make a testable claim, causal mechanism, or falsifiable hypothesis?',
    config: {},
    entropyThreshold: 0.55,
    isSystem: 0,
    sortOrder: 3,
  },
] as const;

const DEFAULT_VIEWS = [
  { id: 'view-high-leverage', name: 'High Leverage', query: 'leverage>=2 status:active', sort: 'recent', sortOrder: 0 },
  { id: 'view-actionable-open', name: 'Actionable Open', query: 'actionable:yes status:active', sort: 'recent', sortOrder: 1 },
  { id: 'view-unread-links', name: 'Unread Links', query: 'b:reference has:url status:active', sort: 'recent', sortOrder: 2 },
] as const;

const DEFAULT_SETTINGS: Record<string, string> = { jev_mode: 'auto' };

export function createDatabase(dbPath: string): Database.Database {
  if (dbPath !== ':memory:') mkdirSync(dirname(resolve(dbPath)), { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('cache_size = -6000');
  db.pragma('mmap_size = 0');
  db.exec(readFileSync(schemaPath, 'utf8'));
  seed(db);
  return db;
}

function seed(db: Database.Database): void {
  const now = Date.now();
  const insertHead = db.prepare(
    `INSERT OR IGNORE INTO decision_heads
       (id, name, primitive, instructions, config_json, entropy_threshold, active, is_system, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
  );
  for (const head of DEFAULT_HEADS) {
    insertHead.run(
      head.id,
      head.name,
      head.primitive,
      head.instructions,
      JSON.stringify(head.config),
      head.entropyThreshold,
      head.isSystem,
      head.sortOrder,
      now,
    );
  }

  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)',
  );
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(key, value, now);

  const insertView = db.prepare(
    `INSERT OR IGNORE INTO saved_views (id, name, query, sort, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const view of DEFAULT_VIEWS) {
    insertView.run(view.id, view.name, view.query, view.sort, view.sortOrder, now);
  }
}

let instance: Database.Database | undefined;

export function getDatabase(): Database.Database {
  if (!instance) instance = createDatabase(config.DB_PATH);
  return instance;
}

export function closeDatabase(): void {
  if (!instance) return;
  instance.close();
  instance = undefined;
}

export { BUCKET_OPTIONS };
