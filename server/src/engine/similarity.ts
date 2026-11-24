import type Database from 'better-sqlite3';
import { ftsTermQuery, getCapture, listCaptures, normalizeSearchText, type Capture } from '../db/queries.js';

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were', 'have', 'has', 'had', 'but', 'not', 'you', 'your', 'our', 'their', 'its', 'into', 'about', 'than', 'then', 'was', 'will', 'can', 'just', 'https', 'http', 'com',
  'و', 'در', 'به', 'از', 'که', 'این', 'آن', 'با', 'بر', 'برای', 'یک', 'باشد', 'است', 'شد', 'بود', 'هم', 'همه', 'اما', ' یا ', 'را', 'تا', 'چرا', 'چطور', 'چگونه',
]);

function topTerms(capture: Capture, limit = 8): string[] {
  const raw = `${capture.content} ${capture.urlTitle ?? ''} ${capture.tags.join(' ')}`;
  const counts = new Map<string, number>();
  for (const word of normalizeSearchText(raw).match(/[\p{L}\p{N}]{3,}/gu) ?? []) {
    if (STOPWORDS.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([word]) => word);
}

function jaccard(a: string[], b: string[]): number {
  const left = new Set(a.map((tag) => tag.toLocaleLowerCase()));
  const right = new Set(b.map((tag) => tag.toLocaleLowerCase()));
  if (left.size === 0 && right.size === 0) return 0;
  let shared = 0;
  for (const tag of left) if (right.has(tag)) shared += 1;
  return shared / (left.size + right.size - shared);
}

export interface RelatedSuggestion {
  capture: Capture;
  score: number;
  reason: string;
}

/** Zero-LLM related captures: FTS5 BM25 + tag overlap + temporal proximity. */
export function findRelatedCaptures(db: Database.Database, captureId: string, limit = 6): RelatedSuggestion[] {
  const source = getCapture(db, captureId);
  if (!source) return [];
  const terms = topTerms(source);
  if (terms.length === 0) return [];
  const query = terms.map((term) => `"${term}"*`).join(' OR ');
  const linked = new Set((db.prepare('SELECT target_id AS id FROM capture_edges WHERE source_id = ? UNION SELECT source_id AS id FROM capture_edges WHERE target_id = ?').all(captureId, captureId) as Array<{ id: string }>).map((row) => row.id));
  const candidates = db.prepare(`
    SELECT f.capture_id, bm25(captures_fts, 10.0, 6.0, 5.0, 2.0) AS rank
    FROM captures_fts f JOIN captures c ON c.id = f.capture_id
    WHERE captures_fts MATCH ? AND c.deleted_at IS NULL AND c.id <> ? ORDER BY rank LIMIT 40
  `).all(query, captureId) as Array<{ capture_id: string; rank: number }>;
  const suggestions: RelatedSuggestion[] = [];
  for (const row of candidates) {
    if (linked.has(row.capture_id)) continue;
    const capture = getCapture(db, row.capture_id);
    if (!capture) continue;
    const tagScore = jaccard(source.tags, capture.tags);
    const sharedTerms = terms.filter((term) => ftsTermQuery(capture.content)?.includes(`"${term}"`) ?? false).length;
    const ageDays = Math.abs(capture.createdAt - source.createdAt) / 86_400_000;
    const temporal = Math.max(0, 1 - ageDays / 30) * 0.1;
    const score = Math.max(0, -row.rank) * 0.05 + sharedTerms * 0.08 + tagScore * 0.5 + temporal;
    const sharedTags = source.tags.filter((tag) => capture.tags.includes(tag));
    const reason = [sharedTags.length ? `shared ${sharedTags.slice(0, 3).map((tag) => `#${tag}`).join(' ')}` : '', sharedTerms ? `${sharedTerms} terms` : 'lexical overlap']
      .filter(Boolean).join(' + ');
    suggestions.push({ capture, score, reason });
  }
  return suggestions.sort((a, b) => b.score - a.score).slice(0, limit);
}

function normalizedTokens(text: string): string[] {
  return normalizeSearchText(text).match(/[\p{L}\p{N}]{3,}/gu) ?? [];
}

function similarity(a: string, b: string): number {
  const tokensA = new Set(normalizedTokens(a));
  const tokensB = new Set(normalizedTokens(b));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let shared = 0;
  for (const token of tokensA) if (tokensB.has(token)) shared += 1;
  const jaccard = shared / (tokensA.size + tokensB.size - shared);
  const trigrams = (value: string) => {
    const out = new Set<string>();
    const clean = normalizeSearchText(value).replace(/\s+/g, ' ');
    for (let i = 0; i < clean.length - 2; i += 1) out.add(clean.slice(i, i + 3));
    return out;
  };
  const gramsA = trigrams(a);
  const gramsB = trigrams(b);
  let sharedGrams = 0;
  for (const gram of gramsA) if (gramsB.has(gram)) sharedGrams += 1;
  const gramScore = gramsA.size && gramsB.size ? sharedGrams / Math.min(gramsA.size, gramsB.size) : 0;
  return jaccard * 0.7 + gramScore * 0.3;
}

export interface DuplicateMatch { capture: Capture; score: number }

export function findDuplicates(db: Database.Database, text: string, threshold = 0.72, limit = 5): DuplicateMatch[] {
  const recent = listCaptures(db, { status: 'all', limit: 500 }).captures;
  return recent.map((capture) => ({ capture, score: similarity(text, capture.content) }))
    .filter((match) => match.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
