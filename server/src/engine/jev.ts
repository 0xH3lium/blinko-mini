import type Database from 'better-sqlite3';
import { choice, noul, score, type Question, type Questions } from '@typesafe-ai/sdk';
import { config } from '../config.js';
import { getSetting, jevUsageTotals, recordJevUsage, type HeadRow } from '../db/queries.js';

export type JevMode = 'auto' | 'off';
export type JevTrigger = 'auto' | 'manual' | 'sweep' | 'playground';

export interface JevState {
  content: string;
  tags: string[];
  url?: { url: string; title: string; excerpt: string };
  parentCapture?: { bucket: string; content: string };
}

export interface JevPrediction {
  headId: string;
  valueText: string | null;
  valueNum: number | null;
  probs: Record<string, number>;
  confidence: number;
  entropy: number;
  modelVersion: string | null;
}

export interface JevResult {
  predictions: JevPrediction[];
  modelVersion: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}

const STATE_BYTE_LIMIT = 28_000;
const PRICE_USD_PER_MILLION_INPUT_TOKENS = 0.042;
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

export function getJevMode(db: Database.Database): JevMode {
  return getSetting(db, 'jev_mode', 'auto') === 'off' ? 'off' : 'auto';
}

export function canSpendJev(db: Database.Database): { ok: boolean; reason?: string } {
  if (getJevMode(db) === 'off') return { ok: false, reason: 'jev_mode=off' };
  if (!config.OPENROUTER_API_KEY) return { ok: false, reason: 'OPENROUTER_API_KEY missing' };
  const totals = jevUsageTotals(db);
  if (totals.todayCalls >= config.JEV_DAILY_CALL_CAP) return { ok: false, reason: 'daily call cap reached' };
  if (totals.todayUsd >= config.JEV_DAILY_USD_CAP) return { ok: false, reason: 'daily USD cap reached' };
  if (totals.monthUsd >= config.JEV_MONTHLY_USD_CAP) return { ok: false, reason: 'monthly USD cap reached' };
  return { ok: true };
}

export function estimateSweepCostUsd(texts: string[], headInstructionsChars: number): number {
  const chars = texts.reduce((sum, text) => sum + text.length + headInstructionsChars, 0);
  const tokens = Math.ceil(chars / 4);
  return Number(((tokens / 1_000_000) * PRICE_USD_PER_MILLION_INPUT_TOKENS).toFixed(6));
}

function configOf(row: HeadRow): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(row.config_json);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function buildQuestion(row: HeadRow): Question {
  const cfg = configOf(row);
  if (row.primitive === 'choice') {
    const options = Array.isArray(cfg.options) ? cfg.options : [];
    const criteria: Record<string, string | null> = {};
    for (const option of options) {
      if (option && typeof option === 'object') {
        const value = (option as { value?: unknown }).value;
        const description = (option as { description?: unknown }).description;
        if (typeof value === 'string') criteria[value] = typeof description === 'string' ? description : null;
      }
    }
    return choice(row.instructions, criteria);
  }
  if (row.primitive === 'score') {
    const min = Math.floor(typeof cfg.min === 'number' ? cfg.min : 0);
    const rawMax = Math.floor(typeof cfg.max === 'number' ? cfg.max : 3);
    const max = Math.min(min + 9, Math.max(min + 1, rawMax));
    const rubric = cfg.rubric && typeof cfg.rubric === 'object' ? (cfg.rubric as Record<string, unknown>) : {};
    const criteria: Array<string | null> = [];
    for (let level = min; level <= max; level += 1) {
      const description = rubric[String(level)];
      criteria.push(typeof description === 'string' && description.trim() ? description : `score ${level}`);
    }
    return score(`${row.instructions} Score range: ${min}..${max}.`, criteria);
  }
  return noul(row.instructions);
}

function normalizeProbs(probs: Record<string, number>): Record<string, number> {
  const numeric: Record<string, number> = {};
  let total = 0;
  for (const [key, value] of Object.entries(probs)) {
    const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
    numeric[key] = safe;
    total += safe;
  }
  if (total > 0 && Math.abs(total - 1) > 1e-6) {
    for (const key of Object.keys(numeric)) numeric[key] = (numeric[key] ?? 0) / total;
  }
  return numeric;
}

function entropyOf(probs: Record<string, number>): number {
  const values = Object.values(probs);
  if (values.length <= 1) return 0;
  let sum = 0;
  for (const p of values) if (p > 0) sum -= p * Math.log(p);
  return Math.min(1, sum / Math.log(values.length));
}

function parseAnswer(row: HeadRow, answer: unknown, modelVersion: string | null): JevPrediction {
  const data = (answer && typeof answer === 'object' ? answer : {}) as Record<string, unknown>;
  if (row.primitive === 'choice') {
    const probs = normalizeProbs((data.probabilities as Record<string, number>) ?? {});
    const valueText = typeof data.choice === 'string' ? data.choice : (Object.keys(probs)[0] ?? null);
    const confidence = typeof data.confidence === 'number' ? data.confidence : (probs[valueText ?? ''] ?? 0);
    return {
      headId: row.id,
      valueText,
      valueNum: null,
      probs,
      confidence,
      entropy: entropyOf(probs),
      modelVersion,
    };
  }
  if (row.primitive === 'noul') {
    const p =
      typeof data.noul === 'number'
        ? data.noul
        : typeof data.probability === 'number'
          ? data.probability
          : 0.5;
    const probability = Math.max(0, Math.min(1, p));
    const probs = { yes: probability, no: 1 - probability };
    return {
      headId: row.id,
      valueText: probability >= 0.5 ? 'yes' : 'no',
      valueNum: probability,
      probs,
      confidence: Math.abs(probability - 0.5) * 2,
      entropy: entropyOf(probs),
      modelVersion,
    };
  }
  const scoreValue = typeof data.score === 'number' ? data.score : 0;
  const probs = normalizeProbs((data.probabilities as Record<string, number>) ?? {});
  return {
    headId: row.id,
    valueText: String(scoreValue),
    valueNum: scoreValue,
    probs,
    confidence: typeof data.confidence === 'number' ? data.confidence : 0.5,
    entropy: entropyOf(probs),
    modelVersion,
  };
}

function truncateState(state: JevState): JevState {
  const candidate: JevState = {
    content: state.content,
    tags: [...state.tags],
    ...(state.url ? { url: { ...state.url } } : {}),
    ...(state.parentCapture ? { parentCapture: { ...state.parentCapture } } : {}),
  };
  const bytes = () => Buffer.byteLength(JSON.stringify(candidate), 'utf8');
  let guard = 0;
  while (bytes() > STATE_BYTE_LIMIT && guard < 40) {
    guard += 1;
    if (candidate.content.length > 200) {
      candidate.content = candidate.content.slice(0, Math.floor(candidate.content.length * 0.8));
    } else if (candidate.parentCapture && candidate.parentCapture.content.length > 200) {
      candidate.parentCapture.content = candidate.parentCapture.content.slice(
        0,
        Math.floor(candidate.parentCapture.content.length * 0.8),
      );
    } else if (candidate.url?.excerpt && candidate.url.excerpt.length > 100) {
      candidate.url.excerpt = candidate.url.excerpt.slice(0, Math.floor(candidate.url.excerpt.length * 0.8));
    } else if (candidate.tags.length > 0) {
      candidate.tags.pop();
    } else if (candidate.content) {
      candidate.content = '';
    } else if (candidate.url?.excerpt) {
      candidate.url.excerpt = '';
    } else if (candidate.parentCapture) {
      candidate.parentCapture.content = '';
    } else {
      break;
    }
  }
  return candidate;
}

function retryDelay(response: Response, attempt: number): number {
  const backoff = 50 * 2 ** attempt;
  const header = response.headers.get('retry-after');
  if (!header) return backoff;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(backoff, Math.max(0, seconds) * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(backoff, date - Date.now()) : backoff;
}

interface WireResult {
  model?: string;
  answers?: Record<string, unknown>;
  usage?: { input_tokens?: number | null; output_tokens?: number | null; cost?: number | null };
}

async function callSystemOne(
  db: Database.Database,
  state: JevState,
  questions: Questions,
  triggerReason: JevTrigger,
  headNames: string[],
): Promise<JevResult | null> {
  const gate = canSpendJev(db);
  if (!gate.ok) {
    console.warn(`[Jev] skipped: ${gate.reason}`);
    return null;
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const body = JSON.stringify({ state: truncateState(state), questions, model: config.JEV_MODEL });
    let payload: WireResult | null = null;
    for (let attempt = 0; attempt <= 2; attempt += 1) {
      const response = await fetch('https://openrouter.ai/api/v1/systemone', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
          'http-referer': config.PUBLIC_URL,
          'x-title': 'Blinko-OS',
        },
        body,
      });
      if (response.ok) {
        payload = (await response.json()) as WireResult;
        break;
      }
      if (RETRYABLE_STATUSES.has(response.status) && attempt < 2) {
        const delay = retryDelay(response, attempt);
        console.warn(`[Jev] HTTP ${response.status}; retry ${attempt + 1}/2 in ${delay}ms`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      console.error(`[Jev] HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
      return null;
    }
    if (!payload) return null;

    const latencyMs = Date.now() - startedAt;
    const modelVersion = typeof payload.model === 'string' ? payload.model : config.JEV_MODEL;
    const answers = payload.answers ?? {};
    const predictions: JevPrediction[] = [];
    for (const [headId, question] of Object.entries(questions)) {
      const row = { id: headId, primitive: question.type } as HeadRow;
      predictions.push(parseAnswer(row, answers[headId], modelVersion));
    }
    const inputTokens = Number(payload.usage?.input_tokens ?? 0);
    const outputTokens = Number(payload.usage?.output_tokens ?? 0);
    const reportedCost = Number(payload.usage?.cost ?? 0);
    const costUsd = Number.isFinite(reportedCost) && reportedCost > 0
      ? reportedCost
      : (inputTokens / 1_000_000) * PRICE_USD_PER_MILLION_INPUT_TOKENS;
    recordJevUsage(db, {
      triggerReason,
      modelVersion,
      heads: headNames,
      inputTokens,
      outputTokens,
      costUsd,
      latencyMs,
    });
    return { predictions, modelVersion, inputTokens, outputTokens, costUsd, latencyMs };
  } catch (error) {
    console.error('[Jev] request failed:', error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** One batched forward pass for every requested head. */
export async function evaluateHeads(
  db: Database.Database,
  state: JevState,
  heads: HeadRow[],
  triggerReason: JevTrigger,
): Promise<JevResult | null> {
  if (heads.length === 0) return null;
  const questions: Questions = {};
  for (const head of heads) questions[head.id] = buildQuestion(head);
  return callSystemOne(db, state, questions, triggerReason, heads.map((head) => head.name));
}
