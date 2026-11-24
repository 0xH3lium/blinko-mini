import type Database from 'better-sqlite3';
import {
  getCapture, getSetting, listCaptures, listEdgesForCapture, listTemplates,
  type Capture, type ExtractorTemplate,
} from '../db/queries.js';

export interface CompileExtractionInput {
  templateId?: string;
  captureIds?: string[];
  q?: string;
  bucket?: string;
  status?: string;
  tag?: string;
  includeNeighbors?: boolean;
  limit?: number;
}

export interface CompiledExtraction {
  text: string;
  captureCount: number;
  neighborCount: number;
  charCount: number;
  estimatedTokens: number;
  obsidianUri?: string;
  template: ExtractorTemplate;
}

function renderFields(capture: Capture): string {
  const entries = Object.values(capture.fields);
  if (entries.length === 0) return '';
  return entries.map((field) => `${field.name}=${field.valueText ?? field.valueNum ?? '–'}${field.locked ? '🔒' : ''}`).join(', ');
}

function renderLinks(db: Database.Database, capture: Capture): string {
  return listEdgesForCapture(db, capture.id)
    .map((edge) => `[[${edge.otherId}:${edge.relation}]] ${edge.otherContent.slice(0, 100)}`)
    .join('\n');
}

function replaceTokens(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => values[key] ?? '');
}

function captureTokens(db: Database.Database, capture: Capture): Record<string, string> {
  return {
    id: capture.id,
    createdAtIso: new Date(capture.createdAt).toISOString(),
    bucket: capture.bucket,
    status: capture.status,
    tags: capture.tags.map((tag) => `#${tag}`).join(' '),
    fields: renderFields(capture),
    content: capture.content,
    sourceUrl: capture.sourceUrl ?? '',
    urlTitle: capture.urlTitle ?? '',
    urlExcerpt: capture.urlExcerpt ?? '',
    dueAtIso: capture.reminder ? new Date(capture.reminder.dueAt).toISOString() : '',
    links: renderLinks(db, capture),
  };
}

export function resolveExtractionTargets(db: Database.Database, input: CompileExtractionInput): { captures: Capture[]; neighbors: Capture[] } {
  const explicit = (input.captureIds ?? []).map((id) => getCapture(db, id)).filter((capture): capture is Capture => Boolean(capture));
  const selector = input.captureIds?.length ? null : listCaptures(db, {
    q: input.q, bucket: input.bucket as Capture['bucket'] | undefined,
    status: (input.status as Capture['status'] | 'all') ?? 'active',
    tag: input.tag, limit: Math.min(input.limit ?? 2000, 2000),
  });
  const captures = explicit.length ? explicit : selector?.captures ?? [];
  const seen = new Set(captures.map((capture) => capture.id));
  const neighbors: Capture[] = [];
  if (input.includeNeighbors) {
    for (const capture of captures) {
      for (const edge of listEdgesForCapture(db, capture.id)) {
        if (seen.has(edge.otherId)) continue;
        seen.add(edge.otherId);
        const other = getCapture(db, edge.otherId);
        if (other) neighbors.push(other);
      }
    }
  }
  return { captures, neighbors };
}

export function compileExtraction(db: Database.Database, input: CompileExtractionInput): CompiledExtraction {
  const template = (input.templateId ? listTemplates(db).find((item) => item.id === input.templateId || item.slug === input.templateId) : undefined)
    ?? listTemplates(db).find((item) => item.isDefault)
    ?? listTemplates(db)[0];
  if (!template) throw new Error('No extractor template found');
  const includeNeighbors = input.includeNeighbors ?? template.includeNeighbors;
  const { captures, neighbors } = resolveExtractionTargets(db, { ...input, includeNeighbors });
  const selected = template.excludeNoise ? captures.filter((capture) => capture.bucket !== 'noise') : captures;
  const items = [
    ...selected.map((capture) => replaceTokens(template.itemTemplate, captureTokens(db, capture))),
    ...(neighbors.length ? [`\n[LINKED CONTEXT]`] : []),
    ...neighbors.map((capture) => replaceTokens(template.itemTemplate, { ...captureTokens(db, capture), id: `${capture.id} (linked)` })),
  ];
  const systemValues: Record<string, string> = {
    date: new Date().toISOString().slice(0, 10),
    count: String(selected.length),
    query: input.q ?? '',
    // shortcut: the six buckets are fixed in the schema; wire to settings if buckets ever become editable.
    buckets_schema: 'idea (spark), memory (durable fact), reminder (action at time), question (open question), reference (external source), noise (low value)',
    fields_schema: JSON.stringify(listFieldsSchema(db)),
    top_tags: (db.prepare('SELECT t.name, COUNT(*) AS count FROM tags t JOIN capture_tags ct ON ct.tag_id = t.id GROUP BY t.id ORDER BY count DESC LIMIT 20').all() as Array<{ name: string }>).map((row) => `#${row.name}`).join(' '),
  };
  const text = [replaceTokens(template.preamble, systemValues), ...items, replaceTokens(template.footer, systemValues)]
    .filter((part) => part.trim()).join('\n\n');
  const result: CompiledExtraction = {
    text, captureCount: selected.length, neighborCount: neighbors.length, charCount: text.length,
    estimatedTokens: Math.ceil(text.length / 4), template,
  };
  if (template.outputMode === 'obsidian_uri') {
    const vault = getSetting(db, 'obsidian_vault', '');
    const folder = getSetting(db, 'obsidian_folder', 'Inbox/Blinko');
    result.obsidianUri = `obsidian://new?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(`${folder}/${new Date().toISOString().slice(0, 10)} Blinko`)}&content=${encodeURIComponent(text)}`;
  }
  return result;
}

function listFieldsSchema(db: Database.Database): Array<{ name: string; alias: string | null; type: string; config: unknown }> {
  return (db.prepare('SELECT name, alias, field_type, config_json FROM custom_fields WHERE active = 1 ORDER BY sort_order').all() as Array<{
    name: string; alias: string | null; field_type: string; config_json: string;
  }>).map((row) => ({ name: row.name, alias: row.alias, type: row.field_type, config: JSON.parse(row.config_json) as unknown }));
}
