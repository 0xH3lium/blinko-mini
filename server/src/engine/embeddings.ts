import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import type Database from 'better-sqlite3';
import { config } from '../config.js';

export const EMBEDDING_DIM = 384;

interface Extractor {
  (text: string, options: { pooling: 'mean'; normalize: boolean }): Promise<{ data: Float32Array | number[] }>;
}

let extractor: Extractor | null = null;
let loading: Promise<void> | null = null;
let queue: Promise<unknown> = Promise.resolve();

/** Serialize inference: one scratchpad at a time keeps native RAM bounded. */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function loadExtractor(): Promise<void> {
  if (extractor || !config.EMBEDDING_ENABLED) return;
  if (loading) return loading;
  loading = (async () => {
    const { pipeline, env } = await import('@huggingface/transformers');
    env.cacheDir = config.DB_PATH === ':memory:' ? config.MODELS_DIR : resolve(dirname(config.DB_PATH), 'models');
    env.allowRemoteModels = true;
    const pipe = await pipeline('feature-extraction', config.EMBEDDING_MODEL, {
      dtype: 'q8',
      device: 'cpu',
      session_options: {
        intraOpNumThreads: 1,
        interOpNumThreads: 1,
        enableCpuMemArena: false,
        enableMemPattern: false,
      },
    });
    extractor = pipe as unknown as Extractor;
  })();
  try {
    await loading;
  } finally {
    loading = null;
  }
}

/** Deterministic 384-d hashed bag-of-ngrams fallback used when embeddings are off. */
export function fallbackEmbedding(text: string): Float32Array {
  const vec = new Float32Array(EMBEDDING_DIM);
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const tokens = normalized.split(' ').filter(Boolean);
  const grams: string[] = [...tokens];
  for (let i = 0; i < tokens.length - 1; i += 1) grams.push(`${tokens[i]} ${tokens[i + 1]}`);
  for (let i = 0; i < normalized.length - 2; i += 1) grams.push(normalized.slice(i, i + 3));
  for (const gram of grams) {
    const digest = createHash('sha256').update(gram).digest();
    const index = digest.readUInt32BE(0) % EMBEDDING_DIM;
    const sign = digest[4]! % 2 === 0 ? 1 : -1;
    vec[index] = (vec[index] ?? 0) + sign;
  }
  return normalizeVector(vec);
}

export function normalizeVector(vec: Float32Array): Float32Array {
  let norm = 0;
  for (const value of vec) norm += value * value;
  norm = Math.sqrt(norm);
  if (norm === 0) {
    vec[0] = 1;
    return vec;
  }
  for (let i = 0; i < vec.length; i += 1) vec[i] = (vec[i] ?? 0) / norm;
  return vec;
}

export async function embed(text: string): Promise<Float32Array> {
  if (!config.EMBEDDING_ENABLED) return fallbackEmbedding(text);
  await loadExtractor();
  if (!extractor) return fallbackEmbedding(text);
  return enqueue(async () => {
    const output = await extractor!(text.slice(0, 4000), { pooling: 'mean', normalize: true });
    const data = output.data instanceof Float32Array ? output.data : new Float32Array(output.data);
    return new Float32Array(data.slice(0, EMBEDDING_DIM));
  });
}

export function cosine(a: Float32Array, b: Float32Array): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < length; i += 1) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot;
}

/** In-memory exact cosine index. Vectors are L2-normalized so dot product == cosine. */
export class VectorIndex {
  private readonly vectors = new Map<string, Float32Array>();

  hydrate(db: Database.Database): void {
    const rows = db.prepare('SELECT id, embedding FROM captures WHERE embedding IS NOT NULL').all() as Array<{
      id: string;
      embedding: Buffer;
    }>;
    for (const row of rows) {
      const copy = Buffer.from(row.embedding);
      this.vectors.set(
        row.id,
        new Float32Array(copy.buffer, copy.byteOffset, Math.floor(copy.byteLength / 4)).slice(),
      );
    }
  }

  upsert(id: string, vec: Float32Array): void {
    this.vectors.set(id, vec);
  }

  remove(id: string): void {
    this.vectors.delete(id);
  }

  get(id: string): Float32Array | undefined {
    return this.vectors.get(id);
  }

  search(query: Float32Array, topK: number, excludeId?: string): Array<{ id: string; score: number }> {
    const results: Array<{ id: string; score: number }> = [];
    for (const [id, vec] of this.vectors) {
      if (id === excludeId) continue;
      results.push({ id, score: cosine(query, vec) });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  size(): number {
    return this.vectors.size;
  }

  clear(): void {
    this.vectors.clear();
  }
}

export const vectorIndex = new VectorIndex();

export function hydrateVectorIndex(db: Database.Database): void {
  vectorIndex.clear();
  vectorIndex.hydrate(db);
}

export function vectorToBlob(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}
