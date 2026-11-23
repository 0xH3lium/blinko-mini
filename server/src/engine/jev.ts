import type Database from 'better-sqlite3';
import { choice, noul, score, type Question, type Questions } from '@typesafe-ai/sdk';
import { config } from '../config.js';
import {
  jevUsageTotals,
  getSetting,
  recordJevUsage,
  type HeadRow,
  type Primitive,
} from '../db/queries.js';

export type JevMode = 'gated' | 'bootstrap' | 'off';
export type JevTrigger =
  | 'cold_start'
  | 'entropy'
  | 'collision'
  | 'reply'
  | 'manual'
  | 'collide'
  | 'url_audit'
  | 'sweep';

export interface JevPrediction {
  headId: string;
  valueText: string | null;
  valueNum: number | null;
  probs: Record<string, number>;
  confidence: number;
  entropy: number;
}

export interface JevResult {
  predictions: JevPrediction[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}

export function getJevMode(db: Database.Database): JevMode {
  const mode = getSetting(db, 'jev_mode', 'gated');
  return mode === 'bootstrap' || mode === 'off' ? mode : 'gated';
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
    const min = typeof cfg.min === 'number' ? Math.floor(cfg.min) : 0;
    const max = typeof cfg.max === 'number' ? Math.floor(cfg.max) : 3;
    const rubric = cfg.rubric && typeof cfg.rubric === 'object' ? (cfg.rubric as Record<string, unknown>) : {};
    const criteria: Array<string | null> = [];
    for (let level = min; level <= max; level += 1) {
      const description = rubric[String(level)];
      criteria.push(typeof description === 'string' ? description : `score ${level}`);
    }
    return score(row.instructions, criteria as [string | null, string | null, ...Array<string | null>]);
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

function parseAnswer(row: HeadRow, answer: unknown): JevPrediction {
  const data = (answer && typeof answer === 'object' ? answer : {}) as Record<string, unknown>;
  if (row.primitive === 'choice') {
    const probs = normalizeProbs((data.probabilities as Record<string, number>) ?? {});
    const valueText = typeof data.choice === 'string' ? data.choice : (Object.keys(probs)[0] ?? null);
    const confidence = typeof data.confidence === 'number' ? data.confidence : (probs[valueText ?? ''] ?? 0);
    return {
      headId: row.id,
      valueText,
      valueNum: probs[valueText ?? ''] ?? confidence,
      probs,
      confidence,
      entropy: entropyOf(probs),
    };
  }
  if (row.primitive === 'noul') {
    const p = typeof data.noul === 'number' ? data.noul : typeof data.probability === 'number' ? data.probability : 0.5;
    const probs = { yes: p, no: 1 - p };
    return {
      headId: row.id,
      valueText: p >= 0.5 ? 'yes' : 'no',
      valueNum: p,
      probs,
      confidence: Math.abs(p - 0.5) * 2,
      entropy: entropyOf(probs),
    };
  }
  const scoreValue = typeof data.score === 'number' ? data.score : 0;
  const probs = normalizeProbs((data.probabilities as Record<string, number>) ?? {});
  return {
    headId: row.id,
    valueText: scoreValue.toFixed(2),
    valueNum: scoreValue,
    probs,
    confidence: typeof data.confidence === 'number' ? data.confidence : 0.5,
    entropy: entropyOf(probs),
  };
}

interface WireResult {
  answers?: Record<string, unknown>;
  usage?: { input_tokens?: number | null; output_tokens?: number | null; cost?: number | null };
}

async function callSystemOne(
  db: Database.Database,
  state: unknown,
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
    const response = await fetch('https://openrouter.ai/api/v1/systemone', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
        'http-referer': config.PUBLIC_URL,
        'x-title': 'Blinko-OS',
      },
      body: JSON.stringify({ state, questions, model: config.JEV_MODEL }),
    });
    if (!response.ok) {
      console.error(`[Jev] HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
      return null;
    }
    const payload = (await response.json()) as WireResult;
    const latencyMs = Date.now() - startedAt;
    const answers = payload.answers ?? {};
    const predictions: JevPrediction[] = [];
    for (const [key, question] of Object.entries(questions)) {
      const row = { id: key, primitive: question.type } as HeadRow;
      predictions.push(parseAnswer(row, answers[key]));
    }
    const usage = {
      inputTokens: Number(payload.usage?.input_tokens ?? 0),
      outputTokens: Number(payload.usage?.output_tokens ?? 0),
      costUsd: Number(payload.usage?.cost ?? 0),
    };
    recordJevUsage(db, {
      triggerReason,
      heads: headNames,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: usage.costUsd,
      latencyMs,
    });
    return { predictions, ...usage, latencyMs };
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
  stateText: string,
  heads: HeadRow[],
  triggerReason: JevTrigger,
): Promise<JevResult | null> {
  if (heads.length === 0) return null;
  const questions: Questions = {};
  for (const head of heads) questions[head.id] = buildQuestion(head);
  const result = await callSystemOne(db, { capture: stateText }, questions, triggerReason, heads.map((head) => head.name));
  if (!result) return null;
  return result;
}

/** Compare a new capture to an existing one; returns a relation label. */
export async function evaluatePairRelation(
  db: Database.Database,
  newText: string,
  candidateText: string,
  triggerReason: JevTrigger = 'collision',
): Promise<{ relation: 'unrelated' | 'reinforces' | 'refines' | 'contradicts'; confidence: number } | null> {
  const questions: Questions = {
    relation: choice('What is the relationship between the new capture and the candidate?', {
      unrelated: 'They are about unrelated topics.',
      reinforces: 'They support or repeat the same underlying claim.',
      refines: 'The new capture sharpens or extends the candidate.',
      contradicts: 'They make incompatible claims or point in opposite directions.',
    }),
  };
  const result = await callSystemOne(
    db,
    { newCapture: newText, candidate: candidateText },
    questions,
    triggerReason,
    ['relation'],
  );
  const answer = result?.predictions[0];
  if (!answer || !answer.valueText) return null;
  const relation = ['unrelated', 'reinforces', 'refines', 'contradicts'].includes(answer.valueText)
    ? (answer.valueText as 'unrelated' | 'reinforces' | 'refines' | 'contradicts')
    : 'unrelated';
  return { relation, confidence: answer.confidence };
}

/** Rate latent cross-domain synthesis potential (0..3). */
export async function scoreCollisionPair(
  db: Database.Database,
  textA: string,
  textB: string,
): Promise<{ score: number; confidence: number } | null> {
  const questions: Questions = {
    analogy: score('How strong is the latent structural analogy or cross-domain synthesis potential between these two captures?', [
      'no meaningful connection',
      'weak thematic overlap',
      'strong structural analogy',
      'non-obvious breakthrough bridge',
    ]),
  };
  const result = await callSystemOne(db, { a: textA, b: textB }, questions, 'collide', ['collision_score']);
  const answer = result?.predictions[0];
  if (!answer || answer.valueNum === null) return null;
  return { score: answer.valueNum, confidence: answer.confidence };
}

export type { Primitive };
