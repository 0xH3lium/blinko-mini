// Real q8 ONNX memory verification for the 400 MB container ceiling.
// Run from the repo root: node server/scripts/ram-check.mjs
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { env, pipeline } from '@huggingface/transformers';

const here = dirname(fileURLToPath(import.meta.url));
const cacheDir = resolve(here, '../../data/models');
const dbPath = resolve(here, '../../data/ram-check.db');
mkdirSync(cacheDir, { recursive: true });
env.cacheDir = cacheDir;

const sentences = [
  'Local decision probes distill expensive model behaviour into cheap linear weights.',
  'Resonance merges near-duplicate thoughts before they multiply.',
  'A paradox edge freezes decay so the contradiction stays visible.',
  'Half-life scoring maps each capture to an exponential decay constant.',
  'The bot answers with one emoji when the routing is confident.',
  'Collision zones are cosine similarities between sixty-eight and ninety-one percent.',
  'Jev escalation is gated by entropy and calibrated confidence.',
  'The war room renders a live force-directed topology on Canvas2D.',
  'Falsifiable claims get higher leverage scores than vague moods.',
  'Zombie reminders are tasks that have been snoozed at least four times.',
  'SQLite WAL mode keeps writes fast while the panel reads.',
  'A single ONNX thread prevents native memory arena hoarding.',
  'The vector index is a contiguous map of normalized Float32 arrays.',
  'Magical links are hashed and expire after sixty seconds.',
  'Bootstrap mode buys labels until the local probe is warm.',
  'Every capture is exactly one atomic record in one of six buckets.',
  'Sublimation quietly removes low-energy captures after the sweep.',
  'The right inspector exposes probabilities with one-click overrides.',
  'Reply edges link a new thought to the message it answers.',
  'Markdown rendering is sanitized before it touches the DOM.',
  'The command palette combines BM25 text rank with cosine neighbours.',
  'Session cookies are HttpOnly, SameSite Lax, and secure behind HTTPS.',
  'Readability extraction is capped at five hundred kilobytes.',
  'SSRF protection rejects private address ranges before fetching.',
  'SimHash produces a sixty-four bit fingerprint for duplicate detection.',
  'Energy boosts by half when a capture resonates with an old one.',
  'The scheduler checks due reminders every sixty seconds.',
  'A targeted sweep previews exact item count and dollar cost first.',
  'Layer one trains online with a small adaptive learning rate.',
  'The monthly budget firewall degrades to local-only rather than crashing.',
];

const start = Date.now();
console.log(`[ram-check] loading ${process.env.EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2'} (q8)…`);
const extractor = await pipeline('feature-extraction', process.env.EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2', {
  dtype: 'q8',
  device: 'cpu',
  cache_dir: cacheDir,
  session_options: {
    intraOpNumThreads: 1,
    interOpNumThreads: 1,
    enableCpuMemArena: false,
    enableMemPattern: false,
  },
});

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('cache_size = -6000');
db.pragma('mmap_size = 0');
db.exec('CREATE TABLE IF NOT EXISTS captures (id TEXT PRIMARY KEY, content TEXT NOT NULL, embedding BLOB);');
db.exec('DELETE FROM captures;');
const insert = db.prepare('INSERT INTO captures (id, content, embedding) VALUES (?, ?, ?)');

for (let i = 0; i < sentences.length; i += 1) {
  const output = await extractor(sentences[i], { pooling: 'mean', normalize: true });
  const data = output.data instanceof Float32Array ? output.data : new Float32Array(output.data);
  insert.run(`ram-${i}`, sentences[i], Buffer.from(new Float32Array(data).buffer));
}

// One exact cosine pass over all vectors, mirroring the RAM VectorIndex.
const rows = db.prepare('SELECT embedding FROM captures').all();
const vectors = rows.map((row) => new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4));
const query = new Float32Array(rows[0].embedding.buffer, rows[0].embedding.byteOffset, 384);
let best = -1;
for (const vector of vectors) {
  let dot = 0;
  for (let i = 0; i < 384; i += 1) dot += (vector[i] ?? 0) * (query[i] ?? 0);
  if (dot > best) best = dot;
}

const memory = process.memoryUsage();
const mb = (value) => Math.round((value / 1_048_576) * 10) / 10;
console.log(`[ram-check] embedded ${sentences.length} sentences in ${Date.now() - start}ms; best cosine ${best.toFixed(4)}`);
console.log(`[ram-check] rss=${mb(memory.rss)}MB heapUsed=${mb(memory.heapUsed)}MB external=${mb(memory.external)}MB`);
console.log(`[ram-check] rss budget < 320MB: ${memory.rss < 320 * 1_048_576 ? 'PASS' : 'FAIL'}`);

db.close();
if (memory.rss >= 320 * 1_048_576) process.exitCode = 1;
