import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.EMBEDDING_ENABLED = 'false';
process.env.BOT_TOKEN = '123456:TEST';
process.env.OWNER_TELEGRAM_ID = '777777';
process.env.DB_PATH = ':memory:';
process.env.DEV_AUTH_BYPASS = 'false';
process.env.OPENROUTER_API_KEY = '';

const { createApp } = await import('../src/app.js');
const { getDatabase } = await import('../src/db/client.js');
const { createLoginToken } = await import('../src/services/auth.service.js');

const app = createApp();

function cookieFrom(response: Response): string {
  const raw = response.headers.get('set-cookie') ?? '';
  return raw.split(';')[0] ?? '';
}

async function login(): Promise<string> {
  const login = createLoginToken(getDatabase());
  const response = await app.request('/auth/code', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: login.code }),
  });
  assert.equal(response.status, 200);
  const cookie = cookieFrom(response);
  assert.ok(cookie.startsWith('blinko_session='));
  return cookie;
}

test('health is public and API is session-gated', async () => {
  const health = await app.request('/api/health');
  assert.equal(health.status, 200);
  const payload = (await health.json()) as { ok: boolean; botMode: string; jevMode: string };
  assert.equal(payload.ok, true);
  assert.equal(payload.botMode, 'polling');
  assert.equal(payload.jevMode, 'gated');

  const unauthorized = await app.request('/api/captures');
  assert.equal(unauthorized.status, 401);
});

test('magic-link and short-code login exchange for an HttpOnly session', async () => {
  const loginToken = createLoginToken(getDatabase());
  const codeResponse = await app.request('/auth/code', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: loginToken.code.toLowerCase() }),
  });
  assert.equal(codeResponse.status, 200);
  assert.equal((codeResponse.headers.get('set-cookie') ?? '').toLowerCase().includes('httponly'), true);

  const magic = createLoginToken(getDatabase());
  const magicResponse = await app.request(`/auth/login?token=${magic.token}`);
  assert.equal(magicResponse.status, 302);
  assert.ok(magicResponse.headers.get('set-cookie'));

  const reused = await app.request(`/auth/login?token=${magic.token}`);
  assert.equal(reused.status, 401);
});

test('full capture CRUD, hybrid search, head filters, override and triage', async () => {
  const cookie = await login();

  const created = await app.request('/api/captures', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ content: 'A reusable mechanism for local decision probes #architecture' }),
  });
  assert.equal(created.status, 201);
  const createdBody = (await created.json()) as { kind: string; captureReturn: { id: string; bucket: string } };
  assert.equal(createdBody.kind, 'capture');
  const id = createdBody.captureReturn.id;

  const list = (await (
    await app.request('/api/captures?q=reusable', { headers: { cookie } })
  ).json()) as { captures: Array<{ id: string }>; total: number };
  assert.ok(list.captures.some((capture) => capture.id === id));

  const all = (await (await app.request('/api/captures', { headers: { cookie } })).json()) as {
    captures: Array<{ id: string }>;
  };
  assert.ok(all.captures.some((capture) => capture.id === id));

  const filters = encodeURIComponent(JSON.stringify([{ head: 'leverage', min: 0 }]));
  const filtered = await app.request(`/api/captures?headFilters=${filters}`, { headers: { cookie } });
  assert.equal(filtered.status, 200);

  const heads = (await (await app.request('/api/heads', { headers: { cookie } })).json()) as {
    heads: Array<{ id: string; name: string }>;
  };
  const bucketHead = heads.heads.find((head) => head.name === 'bucket');
  assert.ok(bucketHead);

  const override = await app.request(`/api/captures/${id}/override`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ headId: bucketHead!.id, valueText: 'memory' }),
  });
  assert.equal(override.status, 200);
  const overridden = (await override.json()) as { bucket: string };
  assert.equal(overridden.bucket, 'memory');

  const patched = await app.request(`/api/captures/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ isPinned: true, tags: ['manual'] }),
  });
  assert.equal(patched.status, 200);
  const patchedBody = (await patched.json()) as { isPinned: boolean; tags: string[] };
  assert.equal(patchedBody.isPinned, true);
  assert.ok(patchedBody.tags.includes('manual'));

  const detail = await app.request(`/api/captures/${id}`, { headers: { cookie } });
  assert.equal(detail.status, 200);

  const triage = await app.request('/api/triage', { headers: { cookie } });
  assert.equal(triage.status, 200);
  const triageBody = (await triage.json()) as Record<string, unknown>;
  for (const key of ['uncertain', 'paradoxes', 'zombies', 'expiring']) assert.ok(key in triageBody);

  const graph = await app.request('/api/graph', { headers: { cookie } });
  assert.equal(graph.status, 200);

  const telemetry = (await (await app.request('/api/telemetry', { headers: { cookie } })).json()) as {
    rssMb: number;
    caps: { dailyCalls: number };
    headStats: Array<{ name: string }>;
  };
  assert.ok(telemetry.rssMb > 0);
  assert.equal(telemetry.caps.dailyCalls, 30);
  assert.ok(telemetry.headStats.some((head) => head.name === 'bucket'));

  const playground = await app.request('/api/heads/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ text: 'Is this falsifiable? Maybe tomorrow at 9am.' }),
  });
  assert.equal(playground.status, 200);

  const deleted = await app.request(`/api/captures/${id}`, { method: 'DELETE', headers: { cookie } });
  assert.equal(deleted.status, 200);
  const gone = await app.request(`/api/captures/${id}`, { headers: { cookie } });
  assert.equal(gone.status, 404);

  const logout = await app.request('/auth/logout', { method: 'POST', headers: { cookie } });
  assert.equal(logout.status, 200);
  const afterLogout = await app.request('/api/captures', { headers: { cookie } });
  assert.equal(afterLogout.status, 401);
});

test('SSE stream connects and emits the connected event', async () => {
  const cookie = await login();
  const controller = new AbortController();
  const response = await app.request('/api/events', { headers: { cookie }, signal: controller.signal });
  assert.equal(response.status, 200);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    while (!buffer.includes('event: connected')) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }
  } finally {
    clearTimeout(timeout);
    controller.abort();
    reader.cancel().catch(() => undefined);
  }
  assert.ok(buffer.includes('event: connected'));
});
