import type Database from 'better-sqlite3';
import { z } from 'zod';
import {
  BUCKETS, deleteFieldValue, getCapture, getField, getFieldsForCapture, getReminder, listCaptures,
  normalizeTags, setCaptureTags, syncCaptureFts, upsertFieldValue, upsertReminder,
  type Bucket, type Capture, type CaptureStatus, type Rule,
} from '../db/queries.js';
import { runDeterministic } from './deterministic.js';

export const ruleConditionsSchema = z.object({
  matchMode: z.enum(['all', 'any']).default('all'),
  regex: z.string().max(500).optional(),
  regexFlags: z.string().max(8).optional(),
  keywords: z.array(z.string().max(100)).max(30).optional(),
  keywordMode: z.enum(['any', 'all']).default('any'),
  hasUrl: z.boolean().optional(),
  urlDomainContains: z.string().max(120).optional(),
  hasDue: z.boolean().optional(),
  minLength: z.number().int().min(0).optional(),
  maxLength: z.number().int().min(0).optional(),
  script: z.enum(['persian', 'latin', 'mixed']).optional(),
  bucketIn: z.array(z.enum(BUCKETS as [Bucket, ...Bucket[]])).optional(),
  tagIn: z.array(z.string()).optional(),
  tagNotIn: z.array(z.string()).optional(),
}).strict();

export const ruleActionsSchema = z.object({
  setBucket: z.enum(BUCKETS as [Bucket, ...Bucket[]]).optional(),
  overrideExplicit: z.boolean().optional(),
  addTags: z.array(z.string()).optional(),
  removeTags: z.array(z.string()).optional(),
  setFields: z.record(z.object({ valueText: z.string().nullable().optional(), valueNum: z.number().nullable().optional() }).strict()).optional(),
  setPin: z.boolean().optional(),
  setStatus: z.enum(['active', 'resolved', 'archived']).optional(),
  setTriaged: z.boolean().optional(),
  markTriaged: z.boolean().optional(),
  ttlMinutes: z.number().int().positive().optional(),
  expireAction: z.enum(['archive', 'trash', 'delete']).optional(),
  reminderOffsetMinutes: z.number().int().optional(),
}).strict();

export type RuleConditions = z.infer<typeof ruleConditionsSchema>;
export type RuleActions = z.infer<typeof ruleActionsSchema>;

export interface RuleContext {
  content: string;
  tags: string[];
  bucket: Bucket;
  explicitBucket?: boolean;
  sourceUrl?: string | null;
  hasDue?: boolean;
  fields?: Record<string, { valueText?: string | null; valueNum?: number | null }>;
}

export interface RulePatch {
  bucket?: Bucket;
  addTags?: string[];
  removeTags?: string[];
  fields?: Record<string, { valueText?: string | null; valueNum?: number | null }>;
  isPinned?: boolean;
  status?: CaptureStatus;
  triaged?: boolean;
  expiresAt?: number;
  expireAction?: 'archive' | 'trash' | 'delete';
  reminderOffsetMinutes?: number;
}

export interface RuleMatch {
  id: string;
  name: string;
  changes: RulePatch;
}

function compile(pattern: string, flags: string): RegExp | null {
  if (pattern.length > 500 || /[^imsu]/i.test(flags)) return null;
  try { return new RegExp(pattern, flags); } catch { return null; }
}

function conditionHits(conditions: RuleConditions, context: RuleContext): { hit: boolean; captures: RegExpExecArray | null } {
  const text = context.content.slice(0, 20_000);
  const tags = new Set(context.tags.map((tag) => tag.toLocaleLowerCase()));
  const checks: boolean[] = [];
  let captures: RegExpExecArray | null = null;
  if (conditions.regex) {
    const regex = compile(conditions.regex, conditions.regexFlags ?? 'iu');
    captures = regex ? regex.exec(text) : null;
    checks.push(captures !== null);
  }
  if (conditions.keywords?.length) {
    const lowered = text.toLocaleLowerCase();
    const hits = conditions.keywords.map((word) => lowered.includes(word.toLocaleLowerCase()));
    checks.push(conditions.keywordMode === 'all' ? hits.every(Boolean) : hits.some(Boolean));
  }
  if (conditions.hasUrl !== undefined) checks.push(Boolean(context.sourceUrl) === conditions.hasUrl);
  if (conditions.urlDomainContains) {
    const host = context.sourceUrl ? (() => { try { return new URL(context.sourceUrl).hostname.toLowerCase(); } catch { return ''; } })() : '';
    checks.push(host.includes(conditions.urlDomainContains.toLowerCase()));
  }
  if (conditions.hasDue !== undefined) checks.push(Boolean(context.hasDue) === conditions.hasDue);
  if (conditions.minLength !== undefined) checks.push(text.length >= conditions.minLength);
  if (conditions.maxLength !== undefined) checks.push(text.length <= conditions.maxLength);
  if (conditions.script) {
    const persian = /[\u0600-\u06ff]/.test(text);
    const latin = /[a-z]/i.test(text);
    const actual = persian && latin ? 'mixed' : persian ? 'persian' : latin ? 'latin' : 'mixed';
    checks.push(actual === conditions.script);
  }
  if (conditions.bucketIn?.length) checks.push(conditions.bucketIn.includes(context.bucket));
  if (conditions.tagIn?.length) checks.push(conditions.tagIn.some((tag) => tags.has(tag.toLocaleLowerCase())));
  if (conditions.tagNotIn?.length) checks.push(!conditions.tagNotIn.some((tag) => tags.has(tag.toLocaleLowerCase())));
  if (checks.length === 0) return { hit: false, captures: null };
  return { hit: conditions.matchMode === 'any' ? checks.some(Boolean) : checks.every(Boolean), captures };
}

function domainTag(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const labels = new URL(url).hostname.toLowerCase().replace(/^www\./, '').split('.');
    return normalizeTags([labels[0] ?? ''])[0] ?? null;
  } catch { return null; }
}

function actionPatch(actions: RuleActions, context: RuleContext, captures: RegExpExecArray | null): RulePatch {
  const patch: RulePatch = {};
  if (actions.setBucket && (!context.explicitBucket || actions.overrideExplicit)) patch.bucket = actions.setBucket;
  const add = [...(actions.addTags ?? [])];
  const dynamic = add.flatMap((tag) => {
    if (tag.includes('{{domain}}')) {
      const domain = domainTag(context.sourceUrl);
      return domain ? [tag.replaceAll('{{domain}}', domain)] : [];
    }
    if (tag.includes('$')) {
      const expanded = tag.replace(/\$(\d)/g, (_match, index: string) => captures?.[Number(index)] ?? '');
      return expanded && !expanded.includes('$') ? [expanded] : [];
    }
    return [tag];
  });
  const expandedTags = normalizeTags(dynamic);
  if (expandedTags.length) patch.addTags = expandedTags;
  if (actions.removeTags?.length) patch.removeTags = normalizeTags(actions.removeTags);
  if (actions.setFields && Object.keys(actions.setFields).length) patch.fields = actions.setFields;
  if (actions.setPin !== undefined) patch.isPinned = actions.setPin;
  if (actions.setStatus) patch.status = actions.setStatus;
  const triaged = actions.setTriaged ?? actions.markTriaged;
  if (triaged !== undefined) patch.triaged = triaged;
  if (actions.ttlMinutes) patch.expiresAt = Date.now() + actions.ttlMinutes * 60_000;
  if (actions.expireAction) patch.expireAction = actions.expireAction;
  if (actions.reminderOffsetMinutes !== undefined) patch.reminderOffsetMinutes = actions.reminderOffsetMinutes;
  return patch;
}

/** Pure rule evaluation: no database access and no side effects. */
export function evaluateRules(rules: Rule[], context: RuleContext): { matchedRules: RuleMatch[]; patch: RulePatch } {
  const ordered = [...rules].sort((a, b) => a.priority - b.priority);
  const matchedRules: RuleMatch[] = [];
  const patch: RulePatch = {};
  let stop = false;
  for (const rule of ordered) {
    if (!rule.enabled || stop) continue;
    const parsedConditions = ruleConditionsSchema.safeParse(rule.conditions);
    const parsedActions = ruleActionsSchema.safeParse(rule.actions);
    if (!parsedConditions.success || !parsedActions.success) continue;
    const { hit, captures } = conditionHits(parsedConditions.data, context);
    if (!hit) continue;
    const changes = actionPatch(parsedActions.data, context, captures);
    matchedRules.push({ id: rule.id, name: rule.name, changes });
    const previousFields = patch.fields;
    const previousTags = patch.addTags ?? [];
    Object.assign(patch, changes);
    if (changes.fields) patch.fields = { ...previousFields, ...changes.fields };
    if (changes.addTags || changes.removeTags) {
      const removed = new Set(changes.removeTags ?? []);
      patch.addTags = normalizeTags([...(changes.addTags ?? []), ...previousTags.filter((tag) => !removed.has(tag))]);
      patch.removeTags = [...new Set([...(patch.removeTags ?? []), ...removed])];
    }
    if (rule.stopOnMatch) stop = true;
  }
  return { matchedRules, patch };
}

/** Apply an evaluated patch inside an open transaction; human-locked fields are respected. */
export function applyRulePatch(db: Database.Database, captureId: string, patch: RulePatch, overwriteLocked = false): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (column: string, value: unknown) => { sets.push(`${column} = ?`); params.push(value); };
  if (patch.bucket) set('bucket', patch.bucket);
  if (patch.isPinned !== undefined) set('is_pinned', patch.isPinned ? 1 : 0);
  if (patch.status) set('status', patch.status);
  if (patch.triaged !== undefined) set('triaged', patch.triaged ? 1 : 0);
  if (patch.expiresAt !== undefined) set('expires_at', patch.expiresAt);
  if (patch.expireAction) set('expire_action', patch.expireAction);
  if (sets.length) {
    set('updated_at', Date.now());
    db.prepare(`UPDATE captures SET ${sets.join(', ')} WHERE id = ?`).run(...params, captureId);
  }
  if (patch.addTags?.length || patch.removeTags?.length) {
    const current = getCapture(db, captureId)?.tags ?? [];
    const removed = new Set(patch.removeTags ?? []);
    setCaptureTags(db, captureId, [...new Set([...current.filter((tag) => !removed.has(tag)), ...(patch.addTags ?? [])])]);
  }
  for (const [name, value] of Object.entries(patch.fields ?? {})) {
    const field = getField(db, name);
    if (!field) continue;
    const existing = getFieldsForCapture(db, captureId)[field.name];
    if (existing?.locked && !overwriteLocked) continue;
    if (existing?.locked && overwriteLocked) deleteFieldValue(db, captureId, field.id);
    upsertFieldValue(db, captureId, field.id, {
      valueText: value.valueText ?? null, valueNum: value.valueNum ?? null,
      source: 'rule', locked: false,
    });
  }
  if (patch.reminderOffsetMinutes !== undefined) {
    const existing = getReminder(db, captureId);
    upsertReminder(db, captureId, {
      dueAt: (existing?.dueAt ?? Date.now()) + patch.reminderOffsetMinutes * 60_000,
      state: 'pending', snoozeCount: existing?.snoozeCount ?? 0, keepRecurrence: true,
    });
  }
  syncCaptureFts(db, captureId);
}

function contextForCapture(db: Database.Database, capture: Capture): RuleContext {
  return {
    content: capture.content, tags: capture.tags, bucket: capture.bucket,
    sourceUrl: capture.sourceUrl, hasDue: Boolean(capture.reminder),
    fields: Object.fromEntries(Object.values(capture.fields).map((field) => [field.name, field])),
  };
}

export interface RulePreview {
  affectedCount: number;
  sampleDiffs: Array<{ id: string; content: string; before: Record<string, unknown>; after: Record<string, unknown> }>;
}

export function previewRuleSweep(db: Database.Database, ruleIdOrAll: string | undefined, q: string): RulePreview {
  const all = listCaptures(db, { q, status: 'active', limit: 2000 });
  const rules = ruleIdOrAll ? db.prepare('SELECT * FROM rules WHERE id = ?').all(ruleIdOrAll) as RuleRow[] : allRules(db);
  const typed = rules.map(ruleFromRowLite);
  const diffs: RulePreview['sampleDiffs'] = [];
  let affected = 0;
  for (const capture of all.captures) {
    const { matchedRules, patch } = evaluateRules(typed, contextForCapture(db, capture));
    if (matchedRules.length === 0) continue;
    affected += 1;
    if (diffs.length < 25) {
      diffs.push({
        id: capture.id, content: capture.content.slice(0, 300),
        before: summarize(capture),
        after: summarize({ ...capture, bucket: patch.bucket ?? capture.bucket, isPinned: patch.isPinned ?? capture.isPinned,
          status: patch.status ?? capture.status, triaged: patch.triaged ?? capture.triaged,
          tags: [...new Set([...capture.tags.filter((tag) => !patch.removeTags?.includes(tag)), ...(patch.addTags ?? [])])] }),
      });
    }
  }
  return { affectedCount: affected, sampleDiffs: diffs };
}

interface RuleRow {
  id: string; name: string; description: string; enabled: number; priority: number; stop_on_match: number;
  conditions_json: string; actions_json: string; hit_count: number; created_at: number; updated_at: number;
}

function ruleFromRowLite(row: RuleRow): Rule {
  return {
    id: row.id, name: row.name, description: row.description, enabled: row.enabled === 1, priority: row.priority,
    stopOnMatch: row.stop_on_match === 1, conditions: JSON.parse(row.conditions_json) as Record<string, unknown>,
    actions: JSON.parse(row.actions_json) as Record<string, unknown>, hitCount: row.hit_count,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function allRules(db: Database.Database): RuleRow[] {
  return db.prepare('SELECT * FROM rules ORDER BY priority ASC').all() as RuleRow[];
}

function summarize(capture: Capture): Record<string, unknown> {
  return { bucket: capture.bucket, status: capture.status, isPinned: capture.isPinned, triaged: capture.triaged, tags: capture.tags };
}

export function executeRuleSweep(db: Database.Database, ruleIdOrAll: string | undefined, q: string, overwriteLocked = false): { affected: number } {
  const page = listCaptures(db, { q, status: 'active', limit: 2000 });
  const rules: RuleRow[] = ruleIdOrAll
    ? db.prepare('SELECT * FROM rules WHERE id = ?').all(ruleIdOrAll) as RuleRow[]
    : allRules(db);
  const typed = rules.map(ruleFromRowLite);
  let affected = 0;
  db.transaction(() => {
    for (const capture of page.captures) {
      const { matchedRules, patch } = evaluateRules(typed, contextForCapture(db, capture));
      if (matchedRules.length === 0) continue;
      applyRulePatch(db, capture.id, patch, overwriteLocked);
      for (const match of matchedRules) {
        db.prepare('UPDATE rules SET hit_count = hit_count + 1 WHERE id = ?').run(match.id);
      }
      affected += 1;
    }
  })();
  return { affected };
}

export async function dryRunText(db: Database.Database, input: { text: string; url?: string }): Promise<{
  deterministic: Awaited<ReturnType<typeof runDeterministic>>;
  matchedRules: RuleMatch[]; patch: RulePatch;
}> {
  const parsed = await runDeterministic(input.text, new Date(), { db, skipUrlFetch: true });
  const { matchedRules, patch } = evaluateRules(listRulesForDryRun(db), {
    content: parsed.text, tags: parsed.tags, bucket: parsed.bucketHint ?? 'idea',
    explicitBucket: Boolean(parsed.bucketHint), sourceUrl: parsed.sourceUrl ?? input.url ?? null,
    hasDue: Boolean(parsed.parsedDueAt),
  });
  return { deterministic: parsed, matchedRules, patch };
}

function listRulesForDryRun(db: Database.Database): Rule[] {
  return allRules(db).map(ruleFromRowLite);
}
