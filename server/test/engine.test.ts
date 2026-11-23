import assert from 'node:assert/strict';
import { test } from 'node:test';
process.env.EMBEDDING_ENABLED = 'false';
process.env.BOT_TOKEN = '123456:TEST';
process.env.OWNER_TELEGRAM_ID = '777777';
process.env.DB_PATH = ':memory:';
process.env.JEV_DAILY_CALL_CAP = '5';
process.env.JEV_DAILY_USD_CAP = '0.01';
process.env.JEV_MONTHLY_USD_CAP = '0.02';
process.env.OPENROUTER_API_KEY = 'test-key';
process.env.JEV_MODE = 'off';

const { createDatabase } = await import('../src/db/client.js');
const { parseDueAt, simhash, lexicalFeatures, extractHashtags, stripPrefixHint, assertSafeUrl } = await import(
  '../src/engine/deterministic.js'
);
const { fallbackEmbedding, cosine, vectorIndex } = await import('../src/engine/embeddings.js');
const { getHeadRow, recordJevUsage, setSetting } = await import('../src/db/queries.js');
const { buildFeatureVector, predictHead, trainStep, FEATURE_DIM } = await import('../src/engine/localProbe.js');
const { canSpendJev } = await import('../src/engine/jev.js');
const { computeEffectiveEnergy, decayLambdaForHalfLife } = await import('../src/engine/physics.js');
const { ingestCapture } = await import('../src/engine/pipeline.js');

test('chrono parsing is anchored to Asia/Tehran and prefers future dates', () => {
  const now = new Date('2026-03-10T06:00:00Z');
  const due = parseDueAt('tomorrow at 9am', now);
  assert.ok(due);
  const formatted = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit',
  }).format(new Date(due!));
  assert.equal(formatted, '09:00');
  assert.equal(parseDueAt('no date here at all', now), null);
});

test('hashtags, prefixes and simhash are deterministic', () => {
  assert.deepEqual(extractHashtags('try #JEV and #jev #idea_2'), ['jev', 'idea_2']);
  assert.deepEqual(stripPrefixHint('!rem call the dentist'), { text: 'call the dentist', bucketHint: 'reminder' });
  assert.deepEqual(stripPrefixHint('mem: keep this'), { text: 'keep this', bucketHint: 'memory' });
  const a = simhash('the same text');
  assert.equal(a, simhash('the same text'));
  assert.notEqual(a, simhash('a different text'));
  assert.equal(a.length, 16);
  assert.equal(lexicalFeatures('Do this? https://x.test #tag 42', Date.now()).length, 12);
});

test('SSRF guard rejects localhost, private ranges and non-http protocols', async () => {
  await assert.rejects(() => assertSafeUrl('http://localhost/admin'));
  await assert.rejects(() => assertSafeUrl('http://127.0.0.1/'));
  await assert.rejects(() => assertSafeUrl('http://10.1.2.3/'));
  await assert.rejects(() => assertSafeUrl('http://172.20.0.1/'));
  await assert.rejects(() => assertSafeUrl('http://192.168.1.1/'));
  await assert.rejects(() => assertSafeUrl('http://169.254.169.254/latest'));
  await assert.rejects(() => assertSafeUrl('http://[::1]/'));
  await assert.rejects(() => assertSafeUrl('file:///etc/passwd'));
  const ok = await assertSafeUrl('https://1.1.1.1/path');
  assert.equal(ok.hostname, '1.1.1.1');
});

test('embedding fallback is normalized and cosine is symmetric', () => {
  const a = fallbackEmbedding('alpha beta gamma');
  const b = fallbackEmbedding('alpha beta gamma');
  const c = fallbackEmbedding('completely different text');
  assert.equal(a.length, 384);
  assert.ok(Math.abs(cosine(a, b) - 1) < 1e-6);
  assert.ok(cosine(a, c) < 0.9);
});

test('online probe learns a synthetic two-class boundary', () => {
  const db = createDatabase(':memory:');
  const head = getHeadRow(db, 'head-bucket')!;
  const idea = new Float32Array(FEATURE_DIM);
  idea[0] = 1;
  const question = new Float32Array(FEATURE_DIM);
  question[1] = 1;
  for (let i = 0; i < 20; i += 1) {
    trainStep(db, getHeadRow(db, 'head-bucket')!, idea, { valueText: 'idea' }, 1);
    trainStep(db, getHeadRow(db, 'head-bucket')!, question, { valueText: 'question' }, 1);
  }
  const refreshed = getHeadRow(db, 'head-bucket')!;
  assert.ok(refreshed.sample_count >= 12);
  assert.equal(predictHead(db, refreshed, idea).valueText, 'idea');
  assert.equal(predictHead(db, refreshed, question).valueText, 'question');
  assert.ok(predictHead(db, refreshed, idea).confidence > 0.5);
  db.close();
});

test('Jev budget firewall degrades cleanly at call and USD caps', () => {
  const db = createDatabase(':memory:');
  setSetting(db, 'jev_mode', 'gated');
  recordJevUsage(db, { triggerReason: 'manual', heads: ['bucket'], inputTokens: 1, outputTokens: 1, costUsd: 0.02, latencyMs: 1 });
  const gate = canSpendJev(db);
  assert.equal(gate.ok, false);
  assert.match(gate.reason ?? '', /cap/);
  setSetting(db, 'jev_mode', 'off');
  assert.equal(canSpendJev(db).ok, false);
  db.close();
});

test('physics decays energy but pins, memory and paradoxes are immune', () => {
  const base = { energy: 1, decay_lambda: 0.05, last_activated_at: Date.now() - 10 * 86_400_000, is_pinned: 0 };
  const decayed = computeEffectiveEnergy(base);
  assert.ok(decayed < 1 && decayed > 0);
  assert.equal(computeEffectiveEnergy({ ...base, is_pinned: 1 }), 1);
  assert.equal(computeEffectiveEnergy(base, Date.now(), true), 1);
  assert.equal(decayLambdaForHalfLife(3), 0);
});

test('ingesting the same capture twice merges as resonance', async () => {
  const db = createDatabase(':memory:');
  vectorIndex.clear();
  setSetting(db, 'jev_mode', 'off');
  const first = await ingestCapture(db, { content: 'A stable idea about local probes and decay physics' });
  assert.equal(first.kind, 'capture');
  const second = await ingestCapture(db, { content: 'A stable idea about local probes and decay physics' });
  assert.equal(second.kind, 'resonance');
  if (second.kind === 'resonance') assert.ok(second.count >= 2);
  db.close();
});

test('collision band creates paradox and contradicts edges via one Jev pair call', async () => {
  const db = createDatabase(':memory:');
  vectorIndex.clear();
  setSetting(db, 'jev_mode', 'gated');
  setSetting(db, 'collision_min_cos', '0.68');
  setSetting(db, 'resonance_min_cos', '0.91');

  const content = 'A local probe collision test about distributed consensus and clocks';
  const base = fallbackEmbedding(content);
  const orth = new Float32Array(384);
  orth[13] = 1;
  let projection = 0;
  for (let i = 0; i < 384; i += 1) projection += (orth[i] ?? 0) * (base[i] ?? 0);
  for (let i = 0; i < 384; i += 1) orth[i] = (orth[i] ?? 0) - projection * (base[i] ?? 0);
  let norm = 0;
  for (const value of orth) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  const candidateVector = new Float32Array(384);
  for (let i = 0; i < 384; i += 1) {
    candidateVector[i] = 0.8 * (base[i] ?? 0) + 0.6 * ((orth[i] ?? 0) / norm);
  }
  const now = Date.now();
  db.prepare(
    `INSERT INTO captures (id, content, bucket, last_activated_at, embedding, created_at, updated_at)
     VALUES ('candidate', 'Old candidate about consensus clocks', 'idea', ?, ?, ?, ?)`,
  ).run(now, Buffer.from(candidateVector.buffer), now, now);
  vectorIndex.upsert('candidate', candidateVector);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { questions?: Record<string, { type: string }> };
    const answers: Record<string, unknown> = {};
    for (const [key, question] of Object.entries(body.questions ?? {})) {
      if (question.type === 'choice') {
        answers[key] = key === 'relation'
          ? { type: 'choice', choice: 'contradicts', confidence: 0.92, probabilities: { unrelated: 0.02, reinforces: 0.03, refines: 0.03, contradicts: 0.92 } }
          : { type: 'choice', choice: 'idea', confidence: 0.8, probabilities: { idea: 0.8, memory: 0.05, reminder: 0.05, question: 0.05, reference: 0.03, noise: 0.02 } };
      } else if (question.type === 'score') {
        answers[key] = { type: 'score', score: 1.5, confidence: 0.7, legend: { 0: 'a', 1: 'b', 2: 'c', 3: 'd' }, probabilities: { 0: 0.1, 1: 0.2, 2: 0.6, 3: 0.1 } };
      } else {
        answers[key] = { type: 'noul', noul: 0.7 };
      }
    }
    return new Response(JSON.stringify({ answers, usage: { input_tokens: 20, output_tokens: 10, cost: 0.0001 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  try {
    const result = await ingestCapture(db, { content });
    assert.equal(result.kind, 'capture');
    if (result.kind === 'capture') {
      assert.ok(result.collision);
      assert.equal(result.collision?.candidateId, 'candidate');
      assert.equal(result.collision?.relation, 'contradicts');
    }
    const { hasParadoxEdge } = await import('../src/db/queries.js');
    const row = db.prepare('SELECT id FROM captures WHERE id != ?').get('candidate') as { id: string };
    assert.equal(hasParadoxEdge(db, row.id), true);
    const edges = db.prepare(`SELECT relation FROM capture_edges WHERE source_id = ? ORDER BY relation`).all(row.id) as Array<{ relation: string }>;
    assert.deepEqual(edges.map((edge) => edge.relation), ['contradicts', 'paradox']);
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});
