import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.BOT_TOKEN = '123456:TEST';
process.env.OWNER_TELEGRAM_ID = '777777';
process.env.DB_PATH = ':memory:';
process.env.DEV_AUTH_BYPASS = 'false';
process.env.OPENROUTER_API_KEY = 'test-key';
process.env.JEV_DAILY_CALL_CAP = '100';
process.env.JEV_DAILY_USD_CAP = '10';
process.env.JEV_MONTHLY_USD_CAP = '100';

const { createApp } = await import('../src/app.js');
const { getDatabase } = await import('../src/db/client.js');
const { createLoginToken } = await import('../src/services/auth.service.js');
const { setSetting } = await import('../src/db/queries.js');

const app = createApp();
const db = getDatabase();

function cookieFrom(response: Response): string {
  return (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

async function login(): Promise<string> {
  const loginToken = createLoginToken(db);
  const response = await app.request('/auth/code', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: loginToken.code }),
  });
  assert.equal(response.status, 200);
  const cookie = cookieFrom(response);
  assert.ok(cookie.startsWith('blinko_session='));
  return cookie;
}

async function json(path: string, cookie: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; body: any }> {
  const response = await app.request(path, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', cookie },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  let body: unknown = null;
  try { body = await response.json(); } catch { /* empty */ }
  return { status: response.status, body };
}

test('health is public and magic-link / 8-character code auth is HttpOnly', async () => {
  const health = await app.request('/api/health');
  assert.equal(health.status, 200);
  const payload = (await health.json()) as { ok: boolean; jevMode: string; jevModel: string };
  assert.equal(payload.ok, true);
  assert.equal(payload.jevMode, 'auto');
  assert.equal(payload.jevModel, 'typesafe/jev-1.14');
  assert.equal((await app.request('/api/captures')).status, 401);

  const loginToken = createLoginToken(db);
  assert.equal(loginToken.code.replace(/[^A-Z0-9]/g, '').length, 8);
  const codeResponse = await app.request('/auth/code', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: loginToken.code.toLowerCase() }),
  });
  assert.equal(codeResponse.status, 200);
  assert.match((codeResponse.headers.get('set-cookie') ?? '').toLowerCase(), /httponly/);
  const reused = await app.request('/auth/code', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: loginToken.code }),
  });
  assert.equal(reused.status, 401);

  const magic = createLoginToken(db);
  const magicResponse = await app.request(`/auth/login?token=${magic.token}`);
  assert.equal(magicResponse.status, 302);
  assert.ok(magicResponse.headers.get('set-cookie'));
});

test('dual-mode capture, edit-anything patch, decisions, edges, bulk, views and export', async () => {
  const cookie = await login();
  setSetting(db, 'jev_mode', 'off');

  const manual = await json('/api/captures', cookie, {
    method: 'POST',
    body: {
      mode: 'manual',
      content: 'manual **markdown** capture',
      bucket: 'idea',
      status: 'active',
      isPinned: false,
      tags: ['manual'],
      sourceUrl: 'https://example.com/a',
      urlTitle: 'A title',
      urlExcerpt: 'An excerpt',
      decisions: { leverage: { valueNum: 2 } },
    },
  });
  assert.equal(manual.status, 201);
  assert.equal(manual.body.jevUsed, false);
  assert.equal(manual.body.capture.captureMode, 'manual');
  assert.equal(manual.body.capture.decisions.leverage.source, 'human');
  const manualId = manual.body.capture.id as string;

  const auto = await json('/api/captures', cookie, { method: 'POST', body: { content: 'auto capture with #fts' } });
  assert.equal(auto.status, 201);
  assert.equal(auto.body.capture.captureMode, 'auto');
  assert.deepEqual(auto.body.capture.decisions, {});
  const autoId = auto.body.capture.id as string;

  const search = await json(`/api/captures?q=${encodeURIComponent('b:idea #fts')}`, cookie);
  assert.equal(search.status, 200);
  assert.ok(search.body.captures.some((capture: { id: string }) => capture.id === autoId));

  const patched = await json(`/api/captures/${manualId}`, cookie, {
    method: 'PATCH',
    body: {
      content: 'new content #should-not-resurrect',
      bucket: 'reference',
      status: 'archived',
      isPinned: true,
      tags: ['manual'],
      reminder: { dueAt: Date.now() + 60_000, state: 'notified', snoozeCount: 3 },
      decisions: { leverage: null, actionable: { valueText: 'yes', valueNum: 1 } },
      meta: { edited: true },
      createdAt: Date.parse('2026-02-02T00:00:00Z'),
    },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.bucket, 'reference');
  assert.equal(patched.body.status, 'archived');
  assert.equal(patched.body.isPinned, true);
  assert.deepEqual(patched.body.tags, ['manual']);
  assert.equal(patched.body.decisions.leverage, undefined);
  assert.equal(patched.body.decisions.actionable.source, 'human');
  assert.equal(patched.body.reminder.snoozeCount, 3);
  assert.deepEqual(patched.body.meta, { edited: true });

  const parent = await json('/api/captures', cookie, {
    method: 'POST', body: { mode: 'manual', content: 'edge parent', bucket: 'idea', status: 'active', isPinned: false, tags: [] },
  });
  const parentId = parent.body.capture.id as string;
  const edgeAdded = await json(`/api/captures/${manualId}/edges`, cookie, {
    method: 'POST', body: { targetId: parentId, relation: 'refines', note: 'human link' },
  });
  assert.equal(edgeAdded.status, 201);
  const detail = await json(`/api/captures/${manualId}`, cookie);
  assert.equal(detail.body.edges.length, 1);
  assert.equal(detail.body.edges[0].otherContent, 'edge parent');
  assert.equal(detail.body.edges[0].direction, 'outgoing');
  const edgeRemoved = await json(`/api/captures/${manualId}/edges`, cookie, {
    method: 'DELETE', body: { targetId: parentId, relation: 'refines' },
  });
  assert.equal(edgeRemoved.status, 200);
  assert.equal(edgeRemoved.body.edges.length, 0);

  const cleared = await json('/api/captures', cookie, {
    method: 'POST', body: { mode: 'manual', content: 'clear me', bucket: 'idea', status: 'active', isPinned: false, tags: [] },
  });
  const clearId = cleared.body.capture.id as string;
  const removedDecision = await json(`/api/captures/${clearId}/decisions/head-bucket`, cookie, { method: 'DELETE' });
  assert.equal(removedDecision.status, 200);
  assert.equal(removedDecision.body.decisions.bucket, undefined);

  const bulk = await json('/api/captures/bulk', cookie, {
    method: 'POST', body: { ids: [manualId, autoId], action: { type: 'addTags', value: ['bulk'] } },
  });
  assert.equal(bulk.status, 200);
  assert.equal(bulk.body.affected, 2);

  const view = await json('/api/views', cookie, { method: 'POST', body: { name: 'Test view', query: 'b:idea' } });
  assert.equal(view.status, 201);
  const viewUpdate = await json(`/api/views/${view.body.id}`, cookie, { method: 'PATCH', body: { query: 'b:memory' } });
  assert.equal(viewUpdate.body.query, 'b:memory');
  assert.equal((await json(`/api/views/${view.body.id}`, cookie, { method: 'DELETE' })).status, 200);

  const exportJson = await app.request('/api/export?format=json', { headers: { cookie } });
  assert.equal(exportJson.status, 200);
  assert.match(exportJson.headers.get('content-disposition') ?? '', /attachment/);
  const exportBody = (await exportJson.json()) as { captures: unknown[]; tags: unknown[]; decisions: unknown[]; reminders: unknown[]; edges: unknown[] };
  for (const key of ['captures', 'tags', 'decisions', 'reminders', 'edges']) assert.ok(Array.isArray(exportBody[key]));
  const exportMd = await app.request('/api/export?format=md', { headers: { cookie } });
  assert.match(await exportMd.text(), /BLINKO\/\/OS export/);
});

test('Jev re-evaluation syncs bucket and human override immediately clears the review queue', async () => {
  const cookie = await login();
  setSetting(db, 'jev_mode', 'auto');
  const original = globalThis.fetch;
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { questions?: Record<string, { type: string }> };
    const answers: Record<string, unknown> = {};
    for (const [key, question] of Object.entries(body.questions ?? {})) {
      if (question.type === 'choice') {
        answers[key] = {
          type: 'choice', choice: 'question', confidence: 0.2,
          probabilities: { idea: 0.2, memory: 0.2, reminder: 0.2, question: 0.2, reference: 0.1, noise: 0.1 },
        };
      } else if (question.type === 'score') {
        answers[key] = { type: 'score', score: 1, confidence: 0.5, legend: {}, probabilities: { 0: 0.2, 1: 0.6, 2: 0.1, 3: 0.1 } };
      } else {
        answers[key] = { type: 'noul', noul: 0.5 };
      }
    }
    return new Response(JSON.stringify({ model: 'typesafe/jev-1.14-test', answers, usage: { input_tokens: 10, output_tokens: 2, cost: 0.0001 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const created = await json('/api/captures', cookie, { method: 'POST', body: { content: 'uncertain routing probe' } });
    assert.equal(created.status, 201);
    const id = created.body.capture.id as string;
    assert.equal(created.body.capture.bucket, 'question');
    assert.equal(created.body.capture.decisions.bucket.source, 'jev');

    const review = await json('/api/review', cookie);
    const reviewItem = review.body.uncertain.find((item: { id: string }) => item.id === id);
    assert.ok(reviewItem);

    const overrides = Object.fromEntries(
      (reviewItem.reviewDecisions as Array<{ headId: string; valueText: string | null; valueNum: number | null }>).map((decision) => [
        decision.headId,
        { valueText: decision.headId === 'head-bucket' ? 'idea' : (decision.valueText ?? 'yes'), valueNum: decision.valueNum ?? 1 },
      ]),
    );
    const override = await json(`/api/captures/${id}`, cookie, { method: 'PATCH', body: { decisions: overrides } });
    assert.equal(override.status, 200);
    assert.equal(override.body.bucket, 'idea');
    assert.equal(override.body.decisions.bucket.source, 'human');
    const after = await json('/api/review', cookie);
    assert.equal(after.body.uncertain.some((item: { id: string }) => item.id === id), false);

    const forced = await json(`/api/captures/${id}/jev`, cookie, { method: 'POST', body: { headIds: ['head-bucket'] } });
    assert.equal(forced.status, 200);
    assert.equal(forced.body.capture.bucket, 'question');
  } finally {
    globalThis.fetch = original;
    setSetting(db, 'jev_mode', 'off');
  }
});

test('agenda, head CRUD with full config, settings firewall and SSE stream', async () => {
  const cookie = await login();
  setSetting(db, 'jev_mode', 'off');

  const reminder = await json('/api/captures', cookie, {
    method: 'POST',
    body: { mode: 'manual', content: 'overdue agenda item', bucket: 'reminder', status: 'active', isPinned: false, tags: [], reminderDueAt: Date.now() - 1000 },
  });
  assert.equal(reminder.status, 201);
  const agenda = await json('/api/agenda', cookie);
  assert.ok(agenda.body.overdue.some((item: { captureId: string }) => item.captureId === reminder.body.capture.id));

  const choiceHead = await json('/api/heads', cookie, {
    method: 'POST',
    body: {
      name: 'Priority', primitive: 'choice', instructions: 'Pick a priority',
      config: { options: [{ value: 'low', description: 'low impact' }, { value: 'high', description: 'high impact' }] },
      entropyThreshold: 0.4, sortOrder: 9, active: true,
    },
  });
  assert.equal(choiceHead.status, 201);
  assert.equal(choiceHead.body.config.options.length, 2);
  const patchedHead = await json(`/api/heads/${choiceHead.body.id}`, cookie, {
    method: 'PATCH',
    body: { entropyThreshold: 0.7, config: { min: 0, max: 4, rubric: { 0: 'a', 1: 'b', 2: 'c', 3: 'd', 4: 'e' } }, primitive: 'score' },
  });
  assert.equal(patchedHead.body.primitive, 'score');
  assert.equal(patchedHead.body.entropyThreshold, 0.7);
  assert.equal(patchedHead.body.config.rubric['4'], 'e');
  assert.equal((await json(`/api/heads/${choiceHead.body.id}`, cookie, { method: 'DELETE' })).status, 200);

  const badSetting = await json('/api/settings', cookie, { method: 'PATCH', body: { jev_mode: 'gated' } });
  assert.equal(badSetting.status, 400);
  const goodSetting = await json('/api/settings', cookie, { method: 'PATCH', body: { jev_mode: 'off' } });
  assert.equal(goodSetting.body.settings.jev_mode, 'off');

  const controller = new AbortController();
  const response = await app.request('/api/events', { headers: { cookie }, signal: controller.signal });
  assert.equal(response.status, 200);
  const reader = response.body!.getReader();
  let buffer = '';
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    while (!buffer.includes('event: connected')) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += new TextDecoder().decode(value, { stream: true });
    }
  } finally {
    clearTimeout(timeout);
    controller.abort();
    await reader.cancel().catch(() => undefined);
  }
  assert.ok(buffer.includes('event: connected'));
});
