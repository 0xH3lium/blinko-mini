import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';

const token = '123456:TEST_TOKEN_FOR_AUTH_TESTS';
const ownerId = 777_777;
process.env.BOT_TOKEN = token;
process.env.OWNER_TELEGRAM_ID = String(ownerId);
process.env.NODE_ENV = 'test';
process.env.DEV_AUTH_BYPASS = 'false';
process.env.DB_PATH = ':memory:';

const { verifyTelegramInitData } = await import('../src/middleware/tgAuth.js');
const { createApp } = await import('../src/app.js');

function signedInitData(
  user: { id: number; first_name: string },
  authDate = Math.floor(Date.now() / 1000),
): string {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: 'AAH-test',
    user: JSON.stringify(user),
  });

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

test('initData HMAC signatures and owner lock are enforced', () => {
  const valid = signedInitData({ id: ownerId, first_name: 'Owner' });
  const ok = verifyTelegramInitData(valid, token, ownerId);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.user.id, ownerId);

  const other = signedInitData({ id: 42, first_name: 'Intruder' });
  assert.deepEqual(verifyTelegramInitData(other, token, ownerId), {
    ok: false,
    reason: 'forbidden',
  });

  const tampered = valid.replace('Owner', 'Mallory');
  assert.deepEqual(verifyTelegramInitData(tampered, token, ownerId), {
    ok: false,
    reason: 'unauthorized',
  });

  assert.deepEqual(verifyTelegramInitData('', token, ownerId), {
    ok: false,
    reason: 'unauthorized',
  });
});

test('health is public and API routes reject missing/bad/other-user auth', async () => {
  const app = createApp();
  const health = await app.request('/api/health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, botMode: 'polling' });

  const missing = await app.request('/api/items');
  assert.equal(missing.status, 401);

  const bad = await app.request('/api/items', {
    headers: { 'X-Telegram-Init-Data': 'auth_date=1&hash=deadbeef' },
  });
  assert.equal(bad.status, 401);

  const intruder = await app.request('/api/items', {
    headers: {
      'X-Telegram-Init-Data': signedInitData({ id: 42, first_name: 'Eve' }),
    },
  });
  assert.equal(intruder.status, 403);

  const authHeader = await app.request('/api/tags', {
    headers: {
      Authorization: `tma ${signedInitData({ id: ownerId, first_name: 'Owner' })}`,
    },
  });
  assert.equal(authHeader.status, 200);
});

test('authenticated API supports the complete capture-to-note flow', async () => {
  const app = createApp();
  const auth = {
    'Content-Type': 'application/json',
    'X-Telegram-Init-Data': signedInitData({ id: ownerId, first_name: 'Owner' }),
  };

  const createdRes = await app.request('/api/items', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      type: 'blink',
      content: 'A quick thought #idea',
      tags: ['seed'],
    }),
  });
  assert.equal(createdRes.status, 201);
  const created = (await createdRes.json()) as {
    id: string;
    type: string;
    tags: string[];
    createdAt: number;
  };
  assert.equal(created.type, 'blink');
  assert.deepEqual(created.tags, ['idea', 'seed']);

  const list = (await (
    await app.request('/api/items?type=blink&q=thought', { headers: auth })
  ).json()) as { total: number; items: Array<{ id: string }> };
  assert.equal(list.total, 1);
  assert.equal(list.items[0]?.id, created.id);

  const single = await app.request(`/api/items/${created.id}`, { headers: auth });
  assert.equal(single.status, 200);

  const patched = await app.request(`/api/items/${created.id}`, {
    method: 'PATCH',
    headers: auth,
    body: JSON.stringify({
      type: 'note',
      title: 'Promoted thought',
      content: 'Expanded markdown #idea #grown',
      isPinned: true,
    }),
  });
  assert.equal(patched.status, 200);
  const note = (await patched.json()) as {
    type: string;
    title: string;
    tags: string[];
    isPinned: boolean;
  };
  assert.equal(note.type, 'note');
  assert.equal(note.title, 'Promoted thought');
  assert.deepEqual(note.tags, ['grown', 'idea', 'seed']);
  assert.equal(note.isPinned, true);

  const tags = (await (
    await app.request('/api/tags', { headers: auth })
  ).json()) as { tags: Array<{ name: string; count: number }> };
  assert.deepEqual(tags.tags, [
    { name: 'grown', count: 1 },
    { name: 'idea', count: 1 },
    { name: 'seed', count: 1 },
  ]);

  const deleted = await app.request(`/api/items/${created.id}`, {
    method: 'DELETE',
    headers: auth,
  });
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { deleted: true, id: created.id });

  const gone = await app.request(`/api/items/${created.id}`, { headers: auth });
  assert.equal(gone.status, 404);
});

test('API validates input and clamps pagination', async () => {
  const app = createApp();
  const auth = {
    'Content-Type': 'application/json',
    'X-Telegram-Init-Data': signedInitData({ id: ownerId, first_name: 'Owner' }),
  };

  const empty = await app.request('/api/items', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ content: '   ' }),
  });
  assert.equal(empty.status, 400);

  const invalidType = await app.request('/api/items?type=idea', { headers: auth });
  assert.equal(invalidType.status, 400);

  const tooBig = await app.request('/api/items?limit=999', { headers: auth });
  assert.equal(tooBig.status, 200);

  const missing = await app.request('/api/items/nope', { headers: auth });
  assert.equal(missing.status, 404);

  const badJson = await app.request('/api/items', {
    method: 'POST',
    headers: auth,
    body: '{no',
  });
  assert.equal(badJson.status, 400);
});
