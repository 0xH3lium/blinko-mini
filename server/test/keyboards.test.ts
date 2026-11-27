import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.BOT_TOKEN = '123456:TEST';
process.env.OWNER_TELEGRAM_ID = '777777';
process.env.DB_PATH = ':memory:';

const {
  BUCKET_EMOJI, captureKeyboard, formatTime, reminderKeyboard, renderCaptureCard, splitCallback, truncate, triageKeyboard,
} = await import('../src/bot/keyboards.js');
const { BUCKETS } = await import('../src/db/queries.js');
type Capture = import('../src/db/queries.js').Capture;

function makeCapture(overrides: Partial<Capture> = {}): Capture {
  return {
    id: 'cap123', content: 'hello world', bucket: 'idea', status: 'active', isPinned: false,
    captureMode: 'auto', triaged: false, expiresAt: null, expireAction: 'archive', deletedAt: null,
    sourceUrl: null, urlTitle: null, urlExcerpt: null, meta: {}, tags: ['x'], fields: {},
    reminder: null, edgeCount: 0, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

test('splitCallback splits action and rest; ids without colons stay intact', () => {
  assert.deepEqual(splitCallback('cap:abc123:pin'), { action: 'cap', rest: ['abc123', 'pin'] });
  assert.deepEqual(splitCallback('cap:abc123:bucket:idea'), { action: 'cap', rest: ['abc123', 'bucket', 'idea'] });
  assert.deepEqual(splitCallback('tri:bucket:memory:abc'), { action: 'tri', rest: ['bucket', 'memory', 'abc'] });
  assert.deepEqual(splitCallback('noop'), { action: 'noop', rest: [] });
});

test('truncate collapses whitespace and ellipsizes', () => {
  assert.equal(truncate('a   b\n\nc', 10), 'a b c');
  assert.equal(truncate('abcdefghij', 5), 'abcd…');
  assert.equal(truncate('short', 10), 'short');
});

test('captureKeyboard marks current bucket, emits stable callbacks, no empty rows', () => {
  const kb = captureKeyboard(makeCapture({ bucket: 'memory', isPinned: true, triaged: true })).inline_keyboard;
  const flat = kb.flat();
  assert.ok(kb.every((row) => row.length > 0), 'no empty keyboard rows');
  // 6 buckets in rows of 3
  assert.equal(kb[0]!.length, 3);
  assert.equal(kb[1]!.length, 3);
  for (const bucket of BUCKETS) {
    const btn = flat.find((b) => b.callback_data === `cap:cap123:bucket:${bucket}`);
    assert.ok(btn, `bucket button ${bucket}`);
  }
  const memoryBtn = flat.find((b) => b.callback_data === 'cap:cap123:bucket:memory')!;
  assert.ok(memoryBtn.text.includes('●'), 'current bucket marked');
  assert.ok(!flat.find((b) => b.callback_data === 'cap:cap123:bucket:idea')!.text.includes('●'));
  assert.ok(flat.some((b) => b.callback_data === 'cap:cap123:pin' && b.text.includes('Unpin')));
  assert.ok(flat.some((b) => b.callback_data === 'cap:cap123:triage' && b.text.includes('Triaged')));
  assert.ok(flat.some((b) => b.callback_data === 'cap:cap123:trash'));
  // every callback_data is within Telegram's 64-byte limit
  for (const b of flat) assert.ok(Buffer.byteLength(b.callback_data ?? '') <= 64);
});

test('reminderKeyboard keeps stable rem callbacks and a back button', () => {
  const flat = reminderKeyboard('cap123').inline_keyboard.flat();
  for (const op of ['done', 'snooze1', 'snooze4', 'tomorrow', 'week', 'kill']) {
    assert.ok(flat.some((b) => b.callback_data === `rem:cap123:${op}`), `op ${op}`);
  }
  assert.ok(flat.some((b) => b.callback_data === 'cap:cap123:open'));
});

test('triageKeyboard has bucket row, actions, paging and exit', () => {
  const flat = triageKeyboard('cap123', 1, 5).inline_keyboard.flat();
  assert.ok(flat.some((b) => b.callback_data === 'tri:bucket:idea:cap123'));
  assert.ok(flat.some((b) => b.callback_data === 'tri:triaged:cap123'));
  assert.ok(flat.some((b) => b.callback_data === 'tri:trash:cap123'));
  assert.ok(flat.some((b) => b.callback_data === 'tri:skip:cap123'));
  assert.ok(flat.some((b) => b.callback_data === 'tri:prev:cap123'));
  assert.ok(flat.some((b) => b.callback_data === 'tri:next:cap123'));
  assert.ok(flat.some((b) => b.text === '2/5'));
  assert.ok(flat.some((b) => b.callback_data === 'tri:exit'));
});

test('renderCaptureCard shows bucket, content, tags, fields, reminder', () => {
  const card = renderCaptureCard(makeCapture({
    content: 'x'.repeat(1000), tags: ['work'], fields: { leverage: { captureId: 'cap123', fieldId: 'f', name: 'leverage', valueText: '3', valueNum: 3, source: 'human', locked: true, updatedAt: 1 } },
    reminder: { captureId: 'cap123', dueAt: 1_700_000_100_000, snoozeCount: 2, recurrence: 'daily', state: 'pending', lastNotifiedAt: null },
  }), 'UTC');
  assert.ok(card.startsWith(`${BUCKET_EMOJI.idea} idea`));
  assert.ok(card.includes('…'), 'long content truncated');
  assert.ok(card.includes('#work'));
  assert.ok(card.includes('leverage=3'));
  assert.ok(card.includes('↻ daily'));
  assert.ok(card.includes('snoozed 2×'));
});

test('formatTime formats in a timezone', () => {
  assert.ok(formatTime(1_700_000_000_000, 'UTC').length > 0);
  assert.equal(formatTime(1_700_000_000_000, 'UTC'), formatTime(1_700_000_000_000, 'UTC'));
});
