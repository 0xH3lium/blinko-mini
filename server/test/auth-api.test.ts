import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.BOT_TOKEN = '123456:TEST';
process.env.OWNER_TELEGRAM_ID = '777777';
process.env.DB_PATH = ':memory:';
process.env.DEV_AUTH_BYPASS = 'false';

const { createApp } = await import('../src/app.js');
const { getDatabase } = await import('../src/db/client.js');
const { createLoginToken } = await import('../src/services/auth.service.js');
const { setSetting, getField } = await import('../src/db/queries.js');

const app = createApp();
const db = getDatabase();

function cookieFrom(response: Response): string {
  return (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

async function login(): Promise<string> {
  const token = createLoginToken(db);
  const response = await app.request('/auth/code', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: token.code }),
  });
  assert.equal(response.status, 200);
  return cookieFrom(response);
}

async function json(path: string, cookie: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; body: any }> {
  const response = await app.request(path, {
    method: init.method ?? 'GET', headers: { 'content-type': 'application/json', cookie },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  let body: unknown = null;
  try { body = await response.json(); } catch { /* empty */ }
  return { status: response.status, body };
}

test('health is public and has zero Jev fields; magic link and 8-char code are HttpOnly', async () => {
  const health = await app.request('/api/health');
  assert.equal(health.status, 200);
  const payload = await health.json() as Record<string, unknown>;
  assert.equal(payload.ok, true);
  assert.equal(payload.jevMode, undefined);
  assert.equal(payload.jevModel, undefined);
  assert.equal((await app.request('/api/captures')).status, 401);

  const token = createLoginToken(db);
  assert.equal(token.code.replace(/[^A-Z0-9]/g, '').length, 8);
  const response = await app.request('/auth/code', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: token.code.toLowerCase() }),
  });
  assert.equal(response.status, 200);
  assert.match((response.headers.get('set-cookie') ?? '').toLowerCase(), /httponly/);
  const reused = await app.request('/auth/code', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: token.code }),
  });
  assert.equal(reused.status, 401);
  const magic = createLoginToken(db);
  const magicResponse = await app.request(`/auth/login?token=${magic.token}`);
  assert.equal(magicResponse.status, 302);
  assert.ok(magicResponse.headers.get('set-cookie'));
});

test('capture CRUD, custom fields, soft trash, bulk actions, edges and unlimited export', async () => {
  const cookie = await login();
  const manual = await json('/api/captures', cookie, {
    method: 'POST', body: {
      mode: 'manual', content: 'manual **markdown** #Work', bucket: 'idea', status: 'active',
      isPinned: false, tags: ['manual'], triaged: true, fields: { leverage: { valueNum: 2 } },
    },
  });
  assert.equal(manual.status, 201);
  assert.equal(manual.body.jevUsed, undefined);
  assert.equal(manual.body.capture.triaged, true);
  assert.equal(manual.body.capture.fields.leverage.source, 'human');
  assert.equal(manual.body.capture.fields.leverage.locked, true);
  const id = manual.body.capture.id as string;

  const auto = await json('/api/captures', cookie, { method: 'POST', body: { content: 'i: deterministic #search !L3' } });
  assert.equal(auto.status, 201);
  assert.equal(auto.body.capture.bucket, 'idea');
  assert.equal(auto.body.capture.content.includes('!L3'), false);
  assert.equal(auto.body.capture.fields.leverage?.valueNum, 3);
  assert.equal(auto.body.capture.triaged, false);

  const search = await json(`/api/captures?q=${encodeURIComponent('b:idea #manual')}`, cookie);
  assert.ok(search.body.captures.some((capture: { id: string }) => capture.id === id));
  const searchUnicode = await json(`/api/captures?q=${encodeURIComponent('#Manual')}`, cookie);
  assert.ok(searchUnicode.body.captures.some((capture: { id: string }) => capture.id === id));

  const patched = await json(`/api/captures/${id}`, cookie, {
    method: 'PATCH', body: {
      bucket: 'reference', status: 'archived', isPinned: true, tags: ['manual', 'verified'],
      fields: { actionable: { valueText: 'yes', valueNum: 1 }, leverage: null },
      meta: { edited: true }, expiresAt: Date.now() + 60_000, expireAction: 'trash',
    },
  });
  assert.equal(patched.body.bucket, 'reference');
  assert.equal(patched.body.fields.leverage, undefined);
  assert.equal(patched.body.fields.actionable.source, 'human');
  assert.equal(patched.body.expiresAt !== null, true);

  const parent = await json('/api/captures', cookie, { method: 'POST', body: {
    mode: 'manual', content: 'edge parent', bucket: 'idea', status: 'active', isPinned: false, tags: [],
  } });
  const edge = await json(`/api/captures/${id}/edges`, cookie, {
    method: 'POST', body: { targetId: parent.body.capture.id, relation: 'refines', note: 'human link' },
  });
  assert.equal(edge.status, 201);
  assert.equal((await json(`/api/captures/${id}`, cookie)).body.edges.length, 1);
  await json(`/api/captures/${id}/edges`, cookie, { method: 'DELETE', body: { targetId: parent.body.capture.id, relation: 'refines' } });

  const bulk = await json('/api/captures/bulk', cookie, {
    method: 'POST', body: { ids: [id, auto.body.capture.id], action: { type: 'addTags', value: ['bulk'] } },
  });
  assert.equal(bulk.body.affected, 2);
  const bulkField = await json('/api/captures/bulk', cookie, {
    method: 'POST', body: { ids: [id], action: { type: 'setField', name: 'domain', value: 'infra' } },
  });
  assert.equal(bulkField.body.affected, 1);

  const view = await json('/api/views', cookie, { method: 'POST', body: { name: 'Test view', query: 'b:idea' } });
  assert.equal(view.status, 201);
  assert.equal((await json(`/api/views/${view.body.id}`, cookie, { method: 'PATCH', body: { query: 'b:memory' } })).body.query, 'b:memory');
  assert.equal((await json(`/api/views/${view.body.id}`, cookie, { method: 'DELETE' })).status, 200);

  const trashed = await json(`/api/captures/${id}`, cookie, { method: 'DELETE' });
  assert.equal(trashed.body.deleted, true);
  assert.equal(trashed.body.permanent, false);
  assert.equal((await json(`/api/captures/${id}`, cookie)).body.deletedAt !== null, true);
  const trashView = await json('/api/captures?q=is:trash&status=all', cookie);
  assert.ok(trashView.body.captures.some((capture: { id: string }) => capture.id === id));
  assert.equal((await json(`/api/captures/${id}/restore`, cookie, { method: 'POST' })).status, 200);
  assert.equal((await app.request(`/api/captures/${id}?permanent=true`, { method: 'DELETE', headers: { cookie } })).status, 200);
  assert.equal((await json(`/api/captures/${id}`, cookie)).status, 404);

  // Export must not be capped at 500 rows.
  const now = Date.now();
  const insert = db.prepare('INSERT INTO captures (id, content, created_at, updated_at) VALUES (?,?,?,?)');
  for (let i = 0; i < 520; i += 1) insert.run(`bulk-${i}`, `export note ${i}`, now + i, now + i);
  const exported = await app.request('/api/export?format=json', { headers: { cookie } });
  assert.equal(exported.status, 200);
  const payload = await exported.json() as { captures: unknown[]; fields: unknown[]; rules: unknown[] };
  assert.ok(payload.captures.length >= 520, `expected full export, got ${payload.captures.length}`);
  assert.ok(Array.isArray(payload.fields) && Array.isArray(payload.rules));
  assert.match(await (await app.request('/api/export?format=md', { headers: { cookie } })).text(), /BLINKO\/\/OS export/);

  const telemetry = await json('/api/telemetry', cookie);
  assert.equal(telemetry.body.jevMode, undefined);
  assert.ok(telemetry.body.activeCaptures > 500);
});

test('triage, reminder actions with recurrence, settings and SSE', async () => {
  const cookie = await login();
  const reminder = await json('/api/captures', cookie, { method: 'POST', body: {
    mode: 'manual', content: 'recurring capture', bucket: 'reminder', status: 'active', isPinned: false,
    tags: [], reminderDueAt: Date.now() - 1000, recurrence: 'daily@08:00',
  } });
  const id = reminder.body.capture.id as string;
  assert.equal(reminder.body.capture.reminder.recurrence, 'daily@08:00');
  assert.ok((await json('/api/triage', cookie)).body.untriaged !== undefined);
  assert.ok((await json('/api/agenda', cookie)).body.overdue.some((item: { captureId: string }) => item.captureId === id));

  const notified = await json(`/api/captures/${id}`, cookie, { method: 'PATCH', body: {
    reminder: { dueAt: Date.now() - 1000, state: 'notified' },
  } });
  assert.equal(notified.body.reminder.state, 'notified');
  const snoozed = await json(`/api/captures/${id}/reminder/action`, cookie, { method: 'POST', body: { action: 'snooze4' } });
  assert.equal(snoozed.body.reminder.state, 'pending');
  assert.equal(snoozed.body.reminder.snoozeCount, 1);
  const done = await json(`/api/captures/${id}/reminder/action`, cookie, { method: 'POST', body: { action: 'done' } });
  assert.equal(done.body.reminder.state, 'pending');
  assert.equal(done.body.reminder.snoozeCount, 0);
  assert.ok(done.body.reminder.dueAt > Date.now());

  const badSetting = await json('/api/settings', cookie, { method: 'PATCH', body: { burst_window_sec: { bad: true } } });
  assert.equal(badSetting.status, 400);
  const settings = await json('/api/settings', cookie, { method: 'PATCH', body: { burst_window_sec: 240, digest_time: '08:30' } });
  assert.equal(settings.body.settings.burst_window_sec, '240');
  assert.equal(settings.body.settings.digest_time, '08:30');
  setSetting(db, 'burst_window_sec', '180');

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
  } finally { clearTimeout(timeout); controller.abort(); await reader.cancel().catch(() => undefined); }
  assert.ok(buffer.includes('event: connected'));
});

test('field, rule, extractor CRUD, simulator, sweeps, extractor compile and JSON patch round trip', async () => {
  const cookie = await login();
  const field = await json('/api/fields', cookie, { method: 'POST', body: {
    name: 'effort', alias: 'ef', fieldType: 'score', config: { min: 0, max: 3, rubric: {} }, showInStream: true,
  } });
  assert.equal(field.status, 201);
  assert.equal((await json(`/api/fields/${field.body.id}`, cookie, { method: 'PATCH', body: { alias: 'e' } })).body.alias, 'e');
  assert.deepEqual((await json('/api/fields', cookie)).body.fields.map((item: { name: string }) => item.name).includes('effort'), true);

  const rule = await json('/api/rules', cookie, { method: 'POST', body: {
    name: 'Persian question', priority: 5, conditions: { regex: '^چرا', regexFlags: 'u' }, actions: { setBucket: 'question', addTags: ['پرسش'] },
  } });
  assert.equal(rule.status, 201);
  const simulated = await json('/api/rules/test', cookie, { method: 'POST', body: { text: 'چرا اینگونه است؟' } });
  assert.ok(simulated.body.matchedRules.some((match: { id: string }) => match.id === rule.body.id));
  assert.equal(simulated.body.final.bucket, 'question');
  const preview = await json('/api/rules/sweep/preview', cookie, { method: 'POST', body: { ruleId: rule.body.id, q: '' } });
  assert.equal(typeof preview.body.affectedCount, 'number');
  const sweep = await json('/api/rules/sweep/run', cookie, { method: 'POST', body: { ruleId: rule.body.id, q: '' } });
  assert.equal(typeof sweep.body.affected, 'number');
  assert.equal((await json(`/api/rules/${rule.body.id}`, cookie, { method: 'PATCH', body: { enabled: false } })).body.enabled, false);

  const template = await json('/api/extractors', cookie, { method: 'POST', body: {
    name: 'Test pack', slug: 'test-pack', preamble: 'count={{count}} fields={{fields_schema}}', itemTemplate: '[{{id}}] {{content}} {{tags}}',
    outputMode: 'download_md', includeNeighbors: false,
  } });
  assert.equal(template.status, 201);
  const source = await json('/api/captures', cookie, { method: 'POST', body: { content: 'extract me #tagged' } });
  const compiled = await json('/api/extract', cookie, { method: 'POST', body: {
    templateId: template.body.id, captureIds: [source.body.capture.id], includeNeighbors: false,
  } });
  assert.equal(compiled.body.captureCount, 1);
  assert.ok(compiled.body.text.includes(`[${source.body.capture.id}]`));
  assert.ok(compiled.body.estimatedTokens > 0);

  const raw = JSON.stringify({ updates: [{ id: source.body.capture.id, bucket: 'reference', addTags: ['patched'], fields: { effort: 2 } }], merges: [], newCaptures: [] });
  const patchPreview = await json('/api/patch/preview', cookie, { method: 'POST', body: { raw: `\`\`\`json\n${raw}\n\`\`\`` } });
  assert.equal(patchPreview.body.errors.length, 0);
  assert.equal(patchPreview.body.diffs[0].after.bucket, 'reference');
  const applied = await json('/api/patch/apply', cookie, { method: 'POST', body: { raw } });
  assert.equal(applied.body.affected, 1);
  const final = await json(`/api/captures/${source.body.capture.id}`, cookie);
  assert.equal(final.body.bucket, 'reference');
  assert.ok(final.body.tags.includes('patched'));
  assert.equal(final.body.fields.effort.source, 'patch');

  const maintenance = await json('/api/system/maintenance', cookie, { method: 'POST', body: { action: 'rebuild_fts' } });
  assert.ok(maintenance.body.rebuilt > 0);
  const imported = await json('/api/import/json', cookie, { method: 'POST', body: {
    captures: [{ id: source.body.capture.id, content: 'imported overwrite', bucket: 'idea', createdAt: Date.now() }], edges: [],
  } });
  assert.equal(imported.body.imported, 1);
  assert.equal((await json(`/api/captures/${source.body.capture.id}`, cookie)).body.content, 'imported overwrite');

  assert.equal((await json(`/api/extractors/${template.body.id}`, cookie, { method: 'DELETE' })).status, 200);
  assert.equal((await json(`/api/rules/${rule.body.id}`, cookie, { method: 'DELETE' })).status, 200);
  assert.equal((await json(`/api/fields/${field.body.id}`, cookie, { method: 'DELETE' })).status, 200);
  assert.ok(getField(db, 'leverage'));
});
