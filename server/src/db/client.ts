import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { config } from '../config.js';

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(here, 'schema.sql');

export const BUCKET_OPTIONS = {
  idea: 'A raw spark, hypothesis, or possible direction worth exploring.',
  memory: 'Durable personal knowledge or a lasting fact to keep verbatim.',
  reminder: 'A concrete thing the owner must do at a specific time.',
  question: 'An open question that still needs a real answer.',
  reference: 'An external source, article, quote, or link worth keeping.',
  noise: 'Low-value chatter with no lasting action or insight.',
};

const DEFAULT_FIELDS = [
  {
    id: 'field-leverage', name: 'leverage', alias: 'L', type: 'score', sortOrder: 1,
    description: 'How much reusable leverage does this capture create?',
    config: { min: 0, max: 3, rubric: { 0: 'noise', 1: 'minor', 2: 'strong reusable', 3: 'asymmetric lever' } },
  },
  { id: 'field-actionable', name: 'actionable', alias: 'act', type: 'boolean', sortOrder: 2, description: 'Has a concrete next action?', config: {} },
  { id: 'field-falsifiable', name: 'falsifiable', alias: 'fals', type: 'boolean', sortOrder: 3, description: 'Makes a testable claim?', config: {} },
  {
    id: 'field-domain', name: 'domain', alias: 'dom', type: 'choice', sortOrder: 4, description: 'Knowledge domain',
    config: { options: [
      { value: 'engineering', label: 'Engineering', color: '#34d399' },
      { value: 'infra', label: 'Infra', color: '#22d3ee' },
      { value: 'pkm', label: 'PKM', color: '#a78bfa' },
      { value: 'ops', label: 'Ops', color: '#fbbf24' },
      { value: 'mindset', label: 'Mindset', color: '#fb7185' },
      { value: 'general', label: 'General', color: '#64717f' },
    ] },
  },
] as const;

const DEFAULT_RULES = [
  {
    id: 'rule-otp', name: 'Ephemeral OTP / Temp Code', priority: 10,
    description: 'One-time codes and verification messages expire quickly.',
    conditions: { matchMode: 'all', regex: '\\b(otp|one[- ]time|رمز\\s*پویا|کد\\s*تایید)\\b', regexFlags: 'iu' },
    actions: { setBucket: 'noise', addTags: ['ephemeral'], ttlMinutes: 30, expireAction: 'trash', markTriaged: true },
  },
  {
    id: 'rule-url-router', name: 'URL Reference Router', priority: 20,
    description: 'Links in ideas are external references; add their domain as a tag.',
    conditions: { matchMode: 'all', hasUrl: true, bucketIn: ['idea'] },
    actions: { setBucket: 'reference', addTags: ['{{domain}}'] },
  },
  {
    id: 'rule-question', name: 'Question Detector', priority: 30,
    description: 'Open questions routed to the question bucket.',
    conditions: { matchMode: 'all', regex: '(\\?$|^(how|why|what|when|where|چرا|چطور|آیا)\\b)', regexFlags: 'iu' },
    actions: { setBucket: 'question' },
  },
  {
    id: 'rule-actionable', name: 'Actionable Imperative', priority: 40,
    description: 'Imperative verbs flag a capture as actionable.',
    conditions: { matchMode: 'all', regex: '^(todo:|solve|calculate|push|plan|fix|build|check|write|implement|study)\\b', regexFlags: 'iu' },
    actions: { setFields: { actionable: { valueText: 'yes', valueNum: 1 } } },
  },
  {
    id: 'rule-stub', name: 'Short Fragment Flag', priority: 90,
    description: 'Very short notes without links are stubs.',
    conditions: { matchMode: 'all', maxLength: 18, hasUrl: false },
    actions: { addTags: ['stub'] },
  },
] as const;

const PATCH_FORMAT = `Return ONLY a JSON object (a \`\`\`json fence is fine) with this exact shape:
{"updates":[{"id":"<capture id>","bucket?":"idea|memory|reminder|question|reference|noise","addTags?":["tag"],"removeTags?":["tag"],"fields?":{"leverage":3,"actionable":true},"status?":"active|resolved|archived","isPinned?":true,"triaged?":true,"reminderDueIso?":"2026-01-01T09:00:00Z","links?":[{"targetId":"<id>","relation":"refines"}]}],
 "merges?":[{"survivorId":"<id>","absorbIds":["<id>"],"mergedContent?":"markdown"}],
 "newCaptures?":[{"content":"atomic note","bucket":"idea","tags":["tag"],"sourceId":"<id>"}]}`;

const DEFAULT_TEMPLATES = [
  {
    id: 'tpl-triage', name: 'AI Triage & Patch (Round-Trip JSON)', slug: 'triage', sortOrder: 1, isDefault: 1, outputMode: 'clipboard',
    description: 'Emit a patch that the Blinko Patch Importer can apply verbatim.',
    preamble: `You are an epistemic triage engine. Buckets: {{buckets_schema}}. Active custom fields: {{fields_schema}}. Existing top tags: {{top_tags}}. Today: {{date}}. Items: {{count}}.\nClassify every item. Prefer tags from the existing list. Never invent IDs. ${PATCH_FORMAT}`,
    item_template: `### {{id}}\n{{content}}\nURL: {{sourceUrl}} — {{urlTitle}}\nFields: {{fields}}\nTags: {{tags}}\nLinks: {{links}}`,
    footer: '\nApply only high-confidence changes. Leave uncertain fields unset.',
    includeNeighbors: 1, excludeNoise: 1,
  },
  {
    id: 'tpl-ontology', name: 'Ontology Heist (Mechanistic Extraction)', slug: 'ontology', sortOrder: 2, isDefault: 0, outputMode: 'clipboard',
    description: 'Strip-mine notes and URLs for mechanisms, invariants and boundaries.',
    preamble: `Strip-mine the following {{count}} notes for state variables, conserved invariants, failure boundaries, saddle points and mathematical/code formulations. Quote the source. Today: {{date}}.\nBuckets: {{buckets_schema}}. Fields: {{fields_schema}}.`,
    item_template: `[{{id}}|{{bucket}}|{{tags}}] {{content}}\n{{urlExcerpt}}\n{{fields}}`,
    footer: '\nFinish with a one-page consolidated mechanism map.',
    includeNeighbors: 1, excludeNoise: 1,
  },
  {
    id: 'tpl-obsidian', name: 'Obsidian Atomic Notes', slug: 'obsidian', sortOrder: 3, isDefault: 0, outputMode: 'obsidian_uri',
    description: 'YAML frontmatter + wikilinks for an Obsidian vault.',
    preamble: 'Render each capture as an atomic Obsidian note with YAML frontmatter and [[wikilinks]] from linked captures.',
    item_template: `---\nid: {{id}}\ncreated: {{createdAtIso}}\nbucket: {{bucket}}\ntags: {{tags}}\nfields: {{fields}}\n---\n\n{{content}}\n\n{{links}}`,
    footer: '', includeNeighbors: 1, excludeNoise: 0,
  },
  {
    id: 'tpl-notebooklm', name: 'NotebookLM Source Pack', slug: 'notebooklm', sortOrder: 4, isDefault: 0, outputMode: 'download_md',
    description: 'Clean chronological dossier grouped by bucket and tags.',
    preamble: '# Source Pack\n\nGenerated {{date}} · {{count}} captures · query: {{query}}\n\nBuckets: {{buckets_schema}}',
    item_template: `## {{createdAtIso}} · {{bucket}} · {{tags}}\n{{content}}\n{{urlTitle}}: {{sourceUrl}}\n{{urlExcerpt}}`,
    footer: '', includeNeighbors: 0, excludeNoise: 1,
  },
  {
    id: 'tpl-sprint', name: 'Execution Sprint Compiler', slug: 'sprint', sortOrder: 5, isDefault: 0, outputMode: 'download_md',
    description: 'Critical-path execution order with timeboxes and a kill-list.',
    preamble: 'Turn these {{count}} captures into a ruthless critical path: dependencies, timeboxes, and a kill-list. Fields: {{fields_schema}}',
    item_template: `- {{id}} [{{bucket}}] {{content}} ({{fields}}) -> {{links}}`,
    footer: '\n## Kill-list\nDrop anything without an owner or next action.',
    includeNeighbors: 1, excludeNoise: 1,
  },
  {
    id: 'tpl-compact', name: 'Raw Ultra-Compact Context', slug: 'compact', sortOrder: 6, isDefault: 0, outputMode: 'clipboard',
    description: 'Minimum token density: [id|bucket|tags] content.',
    preamble: '', item_template: '[{{id}}|{{bucket}}|{{tags}}] {{content}}', footer: '',
    includeNeighbors: 0, excludeNoise: 1,
  },
] as const;

const DEFAULT_SETTINGS: Record<string, string> = {
  owner_timezone: config.OWNER_TIMEZONE,
  burst_window_sec: '180',
  stub_max_chars: '20',
  stale_days: '14',
  trash_retention_days: '30',
  default_reminder_hours: '4',
  digest_enabled: 'true',
  digest_time: '07:55',
  obsidian_vault: '',
  obsidian_folder: 'Inbox/Blinko',
  inline_syntax_enabled: 'true',
  last_digest_date: '',
};

const DEFAULT_VIEWS = [
  { id: 'view-high-leverage', name: 'High Leverage', query: 'leverage>=2 status:active', sort: 'recent', sortOrder: 0 },
  { id: 'view-actionable-open', name: 'Actionable Open', query: 'actionable:yes status:active', sort: 'recent', sortOrder: 1 },
  { id: 'view-unread-links', name: 'Unread Links', query: 'b:reference has:url status:active', sort: 'recent', sortOrder: 2 },
] as const;

/** Upgrade v1 databases in place: add columns, move decisions into fields, drop Jev tables. */
export function runMigrations(db: Database.Database): void {
  const hasColumn = (table: string, column: string): boolean =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((row) => row.name === column);
  const hasTable = (table: string): boolean =>
    (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { 1: number } | undefined) !== undefined;

  db.transaction(() => {
    for (const [column, ddl] of [
      ['triaged', "ALTER TABLE captures ADD COLUMN triaged INTEGER NOT NULL DEFAULT 0 CHECK (triaged IN (0, 1))"],
      ['expires_at', 'ALTER TABLE captures ADD COLUMN expires_at INTEGER'],
      ['expire_action', "ALTER TABLE captures ADD COLUMN expire_action TEXT NOT NULL DEFAULT 'archive' CHECK (expire_action IN ('archive','trash','delete'))"],
      ['deleted_at', 'ALTER TABLE captures ADD COLUMN deleted_at INTEGER'],
    ] as const) {
      if (!hasColumn('captures', column)) db.exec(ddl);
    }
    if (!hasColumn('reminders', 'recurrence')) db.exec('ALTER TABLE reminders ADD COLUMN recurrence TEXT');

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_captures_deleted ON captures (deleted_at);
      CREATE INDEX IF NOT EXISTS idx_captures_expires ON captures (expires_at);
      CREATE INDEX IF NOT EXISTS idx_captures_triaged ON captures (triaged, deleted_at, created_at DESC);
    `);

    // Old manual captures were already reviewed; auto captures start in the Inbox.
    db.exec("UPDATE captures SET triaged = 1 WHERE capture_mode = 'manual' AND triaged = 0");

    if (hasTable('decision_heads')) {
      const aliases: Record<string, string> = { leverage: 'L', actionable: 'act', falsifiable: 'fals', domain: 'dom' };
      const heads = db.prepare('SELECT * FROM decision_heads').all() as Array<{
        id: string; name: string; primitive: string; instructions: string; config_json: string; active: number; sort_order: number; created_at: number;
      }>;
      const insertField = db.prepare(
        `INSERT OR IGNORE INTO custom_fields
           (id, name, alias, field_type, description, config_json, show_in_stream, active, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      );
      for (const head of heads) {
        if (head.name === 'bucket') continue;
        const name = head.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
        if (!name) continue;
        const type = head.primitive === 'noul' ? 'boolean' : head.primitive;
        insertField.run(`field-${name}`, name, aliases[name] ?? null, type, head.instructions, head.config_json, head.active, head.sort_order, head.created_at);
      }

      if (hasTable('capture_decisions')) {
        const decisions = db.prepare('SELECT * FROM capture_decisions').all() as Array<{
          capture_id: string; head_id: string; value_text: string | null; value_num: number | null; source: string; updated_at: number;
        }>;
        const insertFieldValue = db.prepare(
          `INSERT OR IGNORE INTO capture_fields
             (capture_id, field_id, value_text, value_num, source, locked, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const decision of decisions) {
          const head = heads.find((row) => row.id === decision.head_id);
          if (!head || head.name === 'bucket') continue;
          const name = head.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
          const source = decision.source === 'human' ? 'human' : decision.source === 'jev' ? 'rule' : 'rule';
          insertFieldValue.run(decision.capture_id, `field-${name}`, decision.value_text, decision.value_num, source, source === 'human' ? 1 : 0, decision.updated_at);
        }
      }
    }
    db.exec('DROP TABLE IF EXISTS capture_decisions; DROP TABLE IF EXISTS decision_heads; DROP TABLE IF EXISTS jev_usage;');
  })();
}

function seed(db: Database.Database): void {
  const now = Date.now();
  runMigrations(db);
  const insertField = db.prepare(
    `INSERT OR IGNORE INTO custom_fields
       (id, name, alias, field_type, description, config_json, show_in_stream, active, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`,
  );
  for (const field of DEFAULT_FIELDS) {
    insertField.run(field.id, field.name, field.alias, field.type, field.description, JSON.stringify(field.config), field.sortOrder, now);
  }

  const insertRule = db.prepare(
    `INSERT OR IGNORE INTO rules
       (id, name, description, enabled, priority, stop_on_match, conditions_json, actions_json, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, 0, ?, ?, ?, ?)`,
  );
  for (const rule of DEFAULT_RULES) {
    insertRule.run(rule.id, rule.name, rule.description, rule.priority, JSON.stringify(rule.conditions), JSON.stringify(rule.actions), now, now);
  }

  const insertTemplate = db.prepare(
    `INSERT OR IGNORE INTO extractor_templates
       (id, name, slug, description, output_mode, preamble, item_template, footer, include_neighbors, exclude_noise, is_default, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const template of DEFAULT_TEMPLATES) {
    insertTemplate.run(template.id, template.name, template.slug, template.description, template.outputMode, template.preamble, template.item_template, template.footer, template.includeNeighbors, template.excludeNoise, template.isDefault, template.sortOrder, now, now);
  }

  const insertSetting = db.prepare('INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)');
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(key, value, now);

  const insertView = db.prepare(
    `INSERT OR IGNORE INTO saved_views (id, name, query, sort, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const view of DEFAULT_VIEWS) {
    insertView.run(view.id, view.name, view.query, view.sort, view.sortOrder, now);
  }
}

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
