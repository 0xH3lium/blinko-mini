import type Database from 'better-sqlite3';
import type { HeadRow, Primitive } from '../db/queries.js';
import { cosine } from './embeddings.js';

const EMBEDDING_DIM = 384;
const LEXICAL_DIM = 12;
export const FEATURE_DIM = EMBEDDING_DIM + LEXICAL_DIM;
const L2 = 1e-4;
const COLD_START_SAMPLES = 12;

export function buildFeatureVector(embedding: Float32Array, lexical: number[]): Float32Array {
  const x = new Float32Array(FEATURE_DIM);
  for (let i = 0; i < EMBEDDING_DIM; i += 1) x[i] = embedding[i] ?? 0;
  for (let i = 0; i < LEXICAL_DIM; i += 1) x[EMBEDDING_DIM + i] = lexical[i] ?? 0;
  return x;
}

interface ChoiceState {
  kind: 'choice';
  labels: string[];
  W: number[][];
  b: number[];
}

interface NoulState {
  kind: 'noul';
  w: number[];
  b: number;
}

interface ScoreState {
  kind: 'score';
  w: number[];
  b: number;
  min: number;
  max: number;
  residual: number;
}

type ProbeState = ChoiceState | NoulState | ScoreState;

export interface Prediction {
  valueText: string | null;
  valueNum: number | null;
  probs: Record<string, number>;
  confidence: number;
  entropy: number;
  isCold: boolean;
}

function configOf(row: HeadRow): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(row.config_json);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function choiceLabels(row: HeadRow): string[] {
  const options = configOf(row).options;
  if (!Array.isArray(options)) return ['idea', 'memory', 'reminder', 'question', 'reference', 'noise'];
  return options
    .map((option) => (option && typeof option === 'object' ? (option as { value?: unknown }).value : null))
    .filter((value): value is string => typeof value === 'string');
}

function rangeOf(row: HeadRow): { min: number; max: number } {
  const config = configOf(row);
  return {
    min: typeof config.min === 'number' ? config.min : 0,
    max: typeof config.max === 'number' ? config.max : 3,
  };
}

function zeroState(row: HeadRow): ProbeState {
  if (row.primitive === 'choice') {
    const labels = choiceLabels(row);
    return {
      kind: 'choice',
      labels,
      W: labels.map(() => new Array<number>(FEATURE_DIM).fill(0)),
      b: labels.map(() => 0),
    };
  }
  if (row.primitive === 'noul') return { kind: 'noul', w: new Array<number>(FEATURE_DIM).fill(0), b: 0 };
  const { min, max } = rangeOf(row);
  return { kind: 'score', w: new Array<number>(FEATURE_DIM).fill(0), b: min + (max - min) / 2, min, max, residual: 1 };
}

export function loadProbe(row: HeadRow): ProbeState {
  if (!row.probe_weights) return zeroState(row);
  try {
    const parsed = JSON.parse(row.probe_weights.toString('utf8')) as ProbeState;
    if (parsed.kind === 'choice' && parsed.W?.length === choiceLabels(row).length && parsed.W[0]?.length === FEATURE_DIM) {
      return parsed;
    }
    if (parsed.kind === 'noul' && parsed.w?.length === FEATURE_DIM) return parsed;
    if (parsed.kind === 'score' && parsed.w?.length === FEATURE_DIM) return parsed;
  } catch {
    // Corrupt probe: fall back to a fresh zero state.
  }
  return zeroState(row);
}

function softmax(logits: number[]): number[] {
  const max = Math.max(...logits);
  const exps = logits.map((value) => Math.exp(value - max));
  const sum = exps.reduce((acc, value) => acc + value, 0) || 1;
  return exps.map((value) => value / sum);
}

function normalizedEntropy(probs: number[], classes: number): number {
  if (classes <= 1) return 0;
  let sum = 0;
  for (const p of probs) if (p > 0) sum -= p * Math.log(p);
  return Math.min(1, sum / Math.log(classes));
}

function dotWeights(w: number[], x: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < x.length; i += 1) sum += (w[i] ?? 0) * (x[i] ?? 0);
  return sum;
}

export function predictState(state: ProbeState, x: Float32Array): Prediction {
  if (state.kind === 'choice') {
    const logits = state.W.map((w, index) => dotWeights(w, x) + (state.b[index] ?? 0));
    const probs = softmax(logits);
    let best = 0;
    probs.forEach((p, index) => {
      if (p > (probs[best] ?? 0)) best = index;
    });
    const probsMap: Record<string, number> = {};
    state.labels.forEach((label, index) => {
      probsMap[label] = probs[index] ?? 0;
    });
    return {
      valueText: state.labels[best] ?? null,
      valueNum: probs[best] ?? 0,
      probs: probsMap,
      confidence: probs[best] ?? 0,
      entropy: normalizedEntropy(probs, state.labels.length),
      isCold: false,
    };
  }
  if (state.kind === 'noul') {
    const z = dotWeights(state.w, x) + state.b;
    const p = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
    return {
      valueText: p >= 0.5 ? 'yes' : 'no',
      valueNum: p,
      probs: { yes: p, no: 1 - p },
      confidence: Math.abs(p - 0.5) * 2,
      entropy: Math.min(1, -(p * Math.log(Math.max(p, 1e-9)) + (1 - p) * Math.log(Math.max(1 - p, 1e-9))) / Math.log(2)),
      isCold: false,
    };
  }
  const raw = dotWeights(state.w, x) + state.b;
  const value = Math.max(state.min, Math.min(state.max, raw));
  const spread = Math.max(state.residual, 0.05);
  const confidence = Math.max(0, Math.min(1, 1 - spread / (state.max - state.min || 1)));
  const probs: Record<string, number> = {};
  for (let level = Math.ceil(state.min); level <= Math.floor(state.max); level += 1) {
    const distance = Math.abs(level - value);
    probs[String(level)] = Math.exp(-(distance * distance) / (2 * spread * spread));
  }
  const total = Object.values(probs).reduce((acc, p) => acc + p, 0) || 1;
  for (const key of Object.keys(probs)) probs[key] = (probs[key] ?? 0) / total;
  return {
    valueText: String(value.toFixed(2)),
    valueNum: value,
    probs,
    confidence,
    entropy: normalizedEntropy(Object.values(probs), Math.max(2, Object.keys(probs).length)),
    isCold: false,
  };
}

interface LabeledNeighbor {
  embedding: Float32Array;
  valueText: string | null;
  valueNum: number | null;
}

function loadLabeledNeighbors(db: Database.Database, headId: string, limit = 200): LabeledNeighbor[] {
  const rows = db
    .prepare(
      `SELECT c.embedding, cd.value_text, cd.value_num
       FROM capture_decisions cd JOIN captures c ON c.id = cd.capture_id
       WHERE cd.head_id = ? AND c.embedding IS NOT NULL AND cd.source IN ('jev','human')
       ORDER BY cd.created_at DESC LIMIT ?`,
    )
    .all(headId, limit) as Array<{ embedding: Buffer; value_text: string | null; value_num: number | null }>;
  return rows.map((row) => {
    const copy = Buffer.from(row.embedding);
    return {
      embedding: new Float32Array(copy.buffer, copy.byteOffset, Math.floor(copy.byteLength / 4)).slice(),
      valueText: row.value_text,
      valueNum: row.value_num,
    };
  });
}

function knnPredict(row: HeadRow, x: Float32Array, neighbors: LabeledNeighbor[]): Prediction | null {
  if (neighbors.length === 0) return null;
  const scored = neighbors
    .map((neighbor) => ({ neighbor, similarity: cosine(x, neighbor.embedding) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 8);
  if (row.primitive === 'choice') {
    const votes: Record<string, number> = {};
    let total = 0;
    for (const { neighbor, similarity } of scored) {
      const label = neighbor.valueText;
      if (!label) continue;
      const weight = Math.max(0, similarity);
      votes[label] = (votes[label] ?? 0) + weight;
      total += weight;
    }
    const labels = choiceLabels(row);
    if (total === 0) return null;
    const probs: Record<string, number> = {};
    for (const label of labels) probs[label] = (votes[label] ?? 0) / total;
    let best = labels[0] ?? 'idea';
    for (const label of labels) if ((probs[label] ?? 0) > (probs[best] ?? 0)) best = label;
    return {
      valueText: best,
      valueNum: probs[best] ?? 0,
      probs,
      confidence: probs[best] ?? 0,
      entropy: normalizedEntropy(labels.map((label) => probs[label] ?? 0), labels.length),
      isCold: true,
    };
  }
  const values = scored.map((item) => item.neighbor.valueNum).filter((value): value is number => value !== null);
  if (values.length === 0) return null;
  const value = values.reduce((acc, item) => acc + item, 0) / values.length;
  if (row.primitive === 'noul') {
    const probability = Math.max(0, Math.min(1, value));
    return {
      valueText: probability >= 0.5 ? 'yes' : 'no',
      valueNum: probability,
      probs: { yes: probability, no: 1 - probability },
      confidence: Math.abs(probability - 0.5) * 2,
      entropy: Math.min(
        1,
        -(probability * Math.log(Math.max(probability, 1e-9)) + (1 - probability) * Math.log(Math.max(1 - probability, 1e-9))) / Math.log(2),
      ),
      isCold: true,
    };
  }
  const { min, max } = rangeOf(row);
  return {
    valueText: value.toFixed(2),
    valueNum: value,
    probs: { [String(Math.round(value))]: 1 },
    confidence: 0.5,
    entropy: 0.5,
    isCold: true,
    ...(value < min || value > max ? { valueNum: Math.max(min, Math.min(max, value)) } : {}),
  };
}

export function predictHead(db: Database.Database, row: HeadRow, x: Float32Array): Prediction {
  const state = loadProbe(row);
  const prediction = predictState(state, x);
  if (row.sample_count >= COLD_START_SAMPLES) return prediction;
  const knn = knnPredict(row, x, loadLabeledNeighbors(db, row.id));
  return knn ? { ...knn, isCold: true } : { ...prediction, isCold: true };
}

function clipGradient(value: number): number {
  return Math.max(-5, Math.min(5, value));
}

export function trainStep(
  db: Database.Database,
  row: HeadRow,
  x: Float32Array,
  target: { valueText?: string | null; valueNum?: number | null },
  weight = 1,
): void {
  const state = loadProbe(row);
  const learningRate = (0.08 * Math.max(0.2, weight)) / (1 + row.sample_count / 250);

  if (state.kind === 'choice') {
    const targetLabel = target.valueText ?? null;
    const index = targetLabel ? state.labels.indexOf(targetLabel) : -1;
    if (index < 0) return;
    const probs = softmax(state.W.map((w, i) => dotWeights(w, x) + (state.b[i] ?? 0)));
    for (let k = 0; k < state.W.length; k += 1) {
      const error = (probs[k] ?? 0) - (k === index ? 1 : 0);
      const w = state.W[k]!;
      for (let i = 0; i < x.length; i += 1) {
        const grad = clipGradient(error * (x[i] ?? 0) + L2 * (w[i] ?? 0));
        w[i] = (w[i] ?? 0) - learningRate * grad;
      }
      state.b[k] = (state.b[k] ?? 0) - learningRate * clipGradient(error);
    }
  } else if (state.kind === 'noul') {
    const targetValue = target.valueNum ?? (target.valueText === 'yes' ? 1 : 0);
    const yes = Math.max(0, Math.min(1, targetValue));
    const z = dotWeights(state.w, x) + state.b;
    const p = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
    const error = p - yes;
    for (let i = 0; i < x.length; i += 1) {
      const grad = clipGradient(error * (x[i] ?? 0) + L2 * (state.w[i] ?? 0));
      state.w[i] = (state.w[i] ?? 0) - learningRate * grad;
    }
    state.b -= learningRate * clipGradient(error);
  } else {
    const rawTarget = target.valueNum ?? Number(target.valueText ?? state.min);
    const targetValue = Math.max(state.min, Math.min(state.max, rawTarget));
    const prediction = Math.max(state.min, Math.min(state.max, dotWeights(state.w, x) + state.b));
    const error = prediction - targetValue;
    for (let i = 0; i < x.length; i += 1) {
      const grad = clipGradient(error * (x[i] ?? 0) + L2 * (state.w[i] ?? 0));
      state.w[i] = (state.w[i] ?? 0) - learningRate * grad;
    }
    state.b = Math.max(state.min, Math.min(state.max, state.b - learningRate * clipGradient(error)));
    state.residual = state.residual * 0.9 + Math.abs(error) * 0.1;
  }

  db.prepare('UPDATE decision_heads SET probe_weights = ?, sample_count = sample_count + 1 WHERE id = ?').run(
    Buffer.from(JSON.stringify(state)),
    row.id,
  );
}

export function recordAgreement(db: Database.Database, headId: string, agreed: boolean): void {
  db.prepare(
    'UPDATE decision_heads SET eval_count = eval_count + 1, agreement_count = agreement_count + ? WHERE id = ?',
  ).run(agreed ? 1 : 0, headId);
}

export type { HeadRow, Primitive };
