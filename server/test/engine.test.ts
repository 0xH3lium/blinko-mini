import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.BOT_TOKEN = '123456:TEST';
process.env.OWNER_TELEGRAM_ID = '777777';
process.env.DB_PATH = ':memory:';
process.env.OWNER_TIMEZONE = 'Asia/Tehran';
process.env.OPENROUTER_API_KEY = 'test-key';
process.env.JEV_MODEL = 'typesafe/jev-1.14';
process.env.JEV_DAILY_CALL_CAP = '2';
process.env.JEV_DAILY_USD_CAP = '1';
process.env.JEV_MONTHLY_USD_CAP = '10';

const { createDatabase } = await import('../src/db/client.js');
const { parseDueAt, stripPrefixHint, extractHashtags, assertSafeUrl } = await import('../src/engine/deterministic.js');
const { getHeadRow, getReminder, listHeads, recordJevUsage, setSetting } = await import('../src/db/queries.js');
const { canSpendJev, evaluateHeads } = await import('../src/engine/jev.js');
const { createCaptureManual, ingestCaptureAuto } = await import('../src/engine/pipeline.js');

function mockJev(answersFor: (questions: Record<string, { type: string }>) => Record<string, unknown>) {
  const calls: Array<{ body: Record<string, unknown> }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ body });
    return new Response(
      JSON.stringify({
        model: 'typesafe/jev-1.14-2026-01',
        answers: answersFor((body.questions ?? {}) as Record<string, { type: string }>),
        usage: { input_tokens: 1000, output_tokens: 20, cost: 0.001 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function standardAnswers(questions: Record<string, { type: string }>): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  for (const [key, question] of Object.entries(questions)) {
    if (question.type === 'choice') {
      answers[key] = {
        type: 'choice',
        choice: 'idea',
        confidence: 0.9,
        probabilities: { idea: 0.9, memory: 0.04, reminder: 0.02, question: 0.02, reference: 0.01, noise: 0.01 },
      };
    } else if (question.type === 'score') {
      answers[key] = { type: 'score', score: 2, confidence: 0.8, legend: {}, probabilities: { 0: 0.05, 1: 0.1, 2: 0.75, 3: 0.1 } };
    } else {
      answers[key] = { type: 'noul', noul: 0.82 };
    }
  }
  return answers;
}

test('chrono parsing is anchored to Asia/Tehran and prefers future dates', () => {
  const now = new Date('2026-03-10T06:00:00Z');
  const due = parseDueAt('tomorrow at 9am', now);
  assert.ok(due);
  const formatted = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit' }).format(new Date(due!));
  assert.equal(formatted, '09:00');
  assert.equal(parseDueAt('no date here at all', now), null);
});

test('all deterministic prefixes remove themselves and set the right hints', () => {
  assert.deepEqual(stripPrefixHint('!m idea: raw manual capture'), { text: 'raw manual capture', bucketHint: 'idea', manualBypass: true });
  assert.deepEqual(stripPrefixHint('!raw ref: something'), { text: 'something', bucketHint: 'reference', manualBypass: true });
  assert.deepEqual(stripPrefixHint('!rem call the dentist'), { text: 'call the dentist', bucketHint: 'reminder', manualBypass: false });
  assert.deepEqual(stripPrefixHint('remind call the dentist'), { text: 'call the dentist', bucketHint: 'reminder', manualBypass: false });
  assert.deepEqual(stripPrefixHint('mem: keep this'), { text: 'keep this', bucketHint: 'memory', manualBypass: false });
  assert.deepEqual(stripPrefixHint('idea: spark'), { text: 'spark', bucketHint: 'idea', manualBypass: false });
  assert.deepEqual(stripPrefixHint('q: why?'), { text: 'why?', bucketHint: 'question', manualBypass: false });
  assert.deepEqual(stripPrefixHint('ref: https://example.com'), { text: 'https://example.com', bucketHint: 'reference', manualBypass: false });
  assert.deepEqual(extractHashtags('try #JEV and #jev #idea_2'), ['jev', 'idea_2']);
});

test('SSRF guard rejects localhost, private ranges and non-http protocols', async () => {
  for (const url of [
    'http://localhost/admin', 'http://127.0.0.1/', 'http://10.1.2.3/', 'http://172.20.0.1/',
    'http://192.168.1.1/', 'http://169.254.169.254/latest', 'http://[::1]/', 'file:///etc/passwd',
  ]) {
    await assert.rejects(() => assertSafeUrl(url), undefined, url);
  }
  assert.equal((await assertSafeUrl('https://1.1.1.1/path')).hostname, '1.1.1.1');
});

test('Jev batches rich state, records the exact model, and retries retryable failures', async () => {
  const db = createDatabase(':memory:');
  setSetting(db, 'jev_mode', 'auto');
  const original = globalThis.fetch;
  let calls = 0;
  let sentBody: Record<string, unknown> = {};
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    calls += 1;
    sentBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    if (calls === 1) return new Response('rate limited', { status: 429, headers: { 'retry-after': '0' } });
    return new Response(JSON.stringify({ model: 'typesafe/jev-1.14-abc', answers: standardAnswers(sentBody.questions as Record<string, { type: string }>), usage: { input_tokens: 500, output_tokens: 12, cost: 0.0007 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const heads = listHeads(db, true).map((head) => getHeadRow(db, head.id)!);
    const result = await evaluateHeads(db, {
      content: 'A structured mechanism',
      tags: ['fts', 'search'],
      url: { url: 'https://example.com/post', title: 'Post', excerpt: 'Excerpt' },
      parentCapture: { bucket: 'question', content: 'Parent question' },
    }, heads, 'manual');
    assert.equal(calls, 2);
    assert.ok(result);
    assert.equal(result!.modelVersion, 'typesafe/jev-1.14-abc');
    assert.equal(result!.predictions.length, heads.length);
    assert.ok(result!.predictions.every((prediction) => prediction.modelVersion === 'typesafe/jev-1.14-abc'));
    const state = sentBody.state as { content: string; tags: string[]; url?: { url: string }; parentCapture?: { bucket: string } };
    assert.equal(state.content, 'A structured mechanism');
    assert.deepEqual(state.tags, ['fts', 'search']);
    assert.equal(state.url?.url, 'https://example.com/post');
    assert.equal(state.parentCapture?.bucket, 'question');
    assert.equal(sentBody.model, 'typesafe/jev-1.14');
    const usage = db.prepare('SELECT model_version, cost_usd FROM jev_usage').get() as { model_version: string; cost_usd: number };
    assert.equal(usage.model_version, 'typesafe/jev-1.14-abc');
    assert.equal(usage.cost_usd, 0.0007);
  } finally {
    globalThis.fetch = original;
    db.close();
  }
});

test('budget firewall stops Jev when off or when the daily call cap is reached', () => {
  const db = createDatabase(':memory:');
  setSetting(db, 'jev_mode', 'off');
  assert.equal(canSpendJev(db).ok, false);
  setSetting(db, 'jev_mode', 'auto');
  recordJevUsage(db, { triggerReason: 'manual', modelVersion: 'm', heads: ['bucket'], inputTokens: 1, outputTokens: 1, costUsd: 0, latencyMs: 1 });
  recordJevUsage(db, { triggerReason: 'manual', modelVersion: 'm', heads: ['bucket'], inputTokens: 1, outputTokens: 1, costUsd: 0, latencyMs: 1 });
  const gate = canSpendJev(db);
  assert.equal(gate.ok, false);
  assert.match(gate.reason ?? '', /cap/);
  db.close();
});

test('createCaptureManual persists every field with zero fetch calls', async () => {
  const db = createDatabase(':memory:');
  const original = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => { fetchCalls += 1; throw new Error('manual mode must not fetch'); }) as typeof fetch;
  try {
    const parent = await createCaptureManual(db, {
      content: 'parent capture', bucket: 'question', status: 'active', isPinned: false, tags: [],
      reminderDueAt: null, decisions: {}, links: [],
    });
    const createdAt = Date.parse('2026-01-02T03:04:05Z');
    const result = await createCaptureManual(db, {
      content: '#manual capture with **markdown**',
      bucket: 'memory',
      status: 'archived',
      isPinned: true,
      tags: ['manual', 'deep-work'],
      sourceUrl: 'https://example.com/article',
      urlTitle: 'Article title',
      urlExcerpt: 'Article excerpt',
      meta: { source: 'test' },
      createdAt,
      reminderDueAt: createdAt + 60_000,
      reminderState: 'notified',
      snoozeCount: 2,
      decisions: {
        leverage: { valueNum: 3 },
        actionable: { valueText: 'no', valueNum: 0 },
      },
      links: [{ targetId: parent.capture!.id, relation: 'refines', note: 'manual link' }],
    });
    assert.equal(fetchCalls, 0);
    assert.equal(result.jevUsed, false);
    const capture = result.capture!;
    assert.equal(capture.captureMode, 'manual');
    assert.equal(capture.bucket, 'memory');
    assert.equal(capture.status, 'archived');
    assert.equal(capture.isPinned, true);
    assert.deepEqual(capture.tags, ['deep-work', 'manual']);
    assert.equal(capture.urlTitle, 'Article title');
    assert.equal(capture.createdAt, createdAt);
    assert.deepEqual(capture.meta, { source: 'test' });
    assert.equal(capture.decisions['leverage']?.source, 'human');
    assert.equal(capture.decisions['leverage']?.valueNum, 3);
    assert.equal(capture.decisions['bucket']?.valueText, 'memory');
    assert.equal(capture.decisions['bucket']?.source, 'human');
    assert.equal(getReminder(db, capture.id)?.state, 'notified');
    assert.equal(capture.edgeCount, 1);
  } finally {
    globalThis.fetch = original;
    db.close();
  }
});

test('ingestCaptureAuto honours manual bypass and evaluates every active head in one call', async () => {
  const db = createDatabase(':memory:');
  setSetting(db, 'jev_mode', 'auto');
  const bypass = await ingestCaptureAuto(db, { content: '!m idea: manual bypass #raw' });
  assert.equal(bypass.jevUsed, false);
  assert.equal(bypass.capture?.captureMode, 'manual');
  assert.equal(bypass.capture?.bucket, 'idea');
  assert.deepEqual(bypass.capture?.tags, ['raw']);

  const mock = mockJev(standardAnswers);
  try {
    const result = await ingestCaptureAuto(db, { content: 'idea: FTS5 is a deterministic mechanism #search', skipUrlFetch: true });
    assert.equal(mock.calls.length, 1);
    assert.equal(result.jevUsed, true);
    assert.equal(result.capture?.captureMode, 'auto');
    assert.equal(result.capture?.bucket, 'idea');
    assert.equal(result.capture?.decisions['bucket']?.source, 'deterministic');
    assert.equal(result.capture?.decisions['leverage']?.source, 'jev');
    assert.equal(result.capture?.decisions['actionable']?.valueNum, 0.82);
  } finally {
    mock.restore();
    db.close();
  }
});
