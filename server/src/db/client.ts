import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { config } from '../config.js';

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(here, 'schema.sql');

const BUCKET_OPTIONS = {
  idea: 'A raw spark, hypothesis or possible direction.',
  memory: 'Durable personal knowledge or a lasting reference.',
  reminder: 'Something that must happen at a specific time.',
  question: 'An open question that needs an answer.',
  reference: 'An external link, quote or source worth keeping.',
  noise: 'Low-value chatter that can decay quickly.',
};

const DEFAULT_HEADS = [
  {
    id: 'head-bucket',
    name: 'bucket',
    primitive: 'choice',
    instructions: 'Route this capture into exactly one bucket.',
    config: { options: Object.entries(BUCKET_OPTIONS).map(([value, description]) => ({ value, description })) },
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
        0: 'trivial noise',
        1: 'minor useful note',
        2: 'strong insight or reusable principle',
        3: 'high-leverage mechanism or breakthrough',
      },
    },
  },
  {
    id: 'head-half-life',
    name: 'half_life',
    primitive: 'score',
    instructions: 'How long will this capture remain relevant?',
    config: {
      min: 0,
      max: 3,
      rubric: {
        0: 'expires in 48 hours',
        1: 'relevant for ~2 weeks',
        2: 'relevant for ~3 months',
        3: 'permanent invariant or lasting reference',
      },
    },
  },
  {
    id: 'head-falsifiable',
    name: 'falsifiable',
    primitive: 'noul',
    instructions: 'Does this text make a testable claim, causal mechanism, or falsifiable hypothesis?',
    config: {},
  },
] as const;

const DEFAULT_SETTINGS: Record<string, string> = {
  jev_mode: 'gated',
  bootstrap_target: '40',
  collision_min_cos: '0.68',
  resonance_min_cos: '0.91',
  sublimate_energy: '0.15',
};

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
       (id, name, primitive, instructions, config_json, auto_escalate, local_threshold,
        sample_count, agreement_count, eval_count, active, is_system, created_at)
     VALUES (?, ?, ?, ?, ?, 1, 0.86, 0, 0, 0, 1, 1, ?)`,
  );
  for (const head of DEFAULT_HEADS) {
    insertHead.run(head.id, head.name, head.primitive, head.instructions, JSON.stringify(head.config), now);
  }

  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)',
  );
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(key, value, now);
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
