import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.BOT_TOKEN = '123456:TEST';
process.env.OWNER_TELEGRAM_ID = '777777';
process.env.DB_PATH = ':memory:';
process.env.OWNER_TIMEZONE = 'Asia/Tehran';

const { createDatabase } = await import('../src/db/client.js');
const {
  getCapture, getCaptureDetail, getField, getReminder, listCaptures, listRules, setCaptureTags,
  syncCaptureFts, upsertFieldValue, upsertReminder, getSetting, setSetting,
} = await import('../src/db/queries.js');
const { runDeterministic, extractHashtags, assertSafeUrl, fetchReadable, nextDueAt, tomorrowAt } = await import('../src/engine/deterministic.js');
const { evaluateRules, executeRuleSweep, previewRuleSweep } = await import('../src/engine/rules.js');
const { ingestCaptureAuto, ingestBatch, createCaptureManual, mergeCaptures, reextractEdited } = await import('../src/engine/pipeline.js');
const { findRelatedCaptures, findDuplicates } = await import('../src/engine/similarity.js');
const { compileExtraction } = await import('../src/engine/extractor.js');
const { parsePatch, previewPatch, applyPatch } = await import('../src/engine/patcher.js');
const { ttlSweep, runTrashPurge } = await import('../src/engine/scheduler.js');
const { initCapturesService } = await import('../src/services/captures.service.js');

test('inline micro-syntax parses bucket, fields, TTL, recurrence, pin, append and link', async () => {
  const db = createDatabase(':memory:');
  const result = await runDeterministic('i: Solve chapter 1 #reservoir !L3 !act @domain:infra !pin !ttl 15m !every day 8am', new Date(), { db, skipUrlFetch: true });
  assert.equal(result.bucketHint, 'idea');
  assert.deepEqual(result.tags, ['reservoir']);
  assert.equal(result.fields.leverage?.valueNum, 3);
  assert.equal(result.fields.actionable?.valueText, 'yes');
  assert.equal(result.fields.domain?.valueText, 'infra');
  assert.equal(result.isPinned, true);
  assert.ok(result.expiresAt && result.expiresAt > Date.now());
  assert.equal(result.recurrence, 'daily@08:00');
  assert.ok(result.parsedDueAt && result.parsedDueAt > Date.now());
  assert.match(result.text, /Solve chapter 1/);
  assert.doesNotMatch(result.text, /!L3|!ttl|!every|!pin|@domain/);

  const append = await runDeterministic('++ extra detail', new Date(), { db, skipUrlFetch: true });
  assert.equal(append.appendToLast, true);
  const link = await runDeterministic('^ connected note', new Date(), { db, skipUrlFetch: true });
  assert.equal(link.linkToLast, true);
  assert.deepEqual(extractHashtags('note #انرژی and #work_2'), ['انرژی', 'work_2']);
  const weekly = nextDueAt('weekly:mon,thu@09:00', Date.now());
  assert.ok(weekly && weekly > Date.now());
  const tomorrow = tomorrowAt(9, 0, new Date('2026-01-01T12:00:00Z'), 'Asia/Tehran');
  const hour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', hour: '2-digit', hourCycle: 'h23' }).format(new Date(tomorrow));
  assert.equal(hour, '09');
  db.close();
});

test('SSRF guard blocks a 302 redirect to localhost', async () => {
  await assert.rejects(() => assertSafeUrl('http://127.0.0.1:3000/admin'));
  await assert.rejects(() => assertSafeUrl('file:///etc/passwd'));
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:3000/admin' } });
  }) as typeof fetch;
  try {
    assert.equal(await fetchReadable('https://example.com/article'), null);
    assert.equal(calls, 1, 'redirect target must be rejected before a second request');
  } finally { globalThis.fetch = original; }
});

test('rules evaluate in priority order, respect stopOnMatch and expand $1 / domain tags', () => {
  const db = createDatabase(':memory:');
  const rules = listRules(db);
  const first = evaluateRules(rules, { content: 'Look at https://github.com/blinko/os', tags: [], bucket: 'idea', sourceUrl: 'https://github.com/blinko/os' });
  assert.ok(first.matchedRules.some((match) => match.name === 'URL Reference Router'));
  assert.ok(first.patch.addTags?.includes('github'));
  assert.equal(first.patch.bucket, 'reference');
  const captured = evaluateRules([{
    ...rules[4]!, id: 'capture-rule', name: 'Capture group', priority: 1,
    conditions: { regex: '^Replace (\\w+)', regexFlags: 'iu' }, actions: { addTags: ['$1'] },
  }], { content: 'Replace reservoir with notes', tags: [], bucket: 'idea' });
  assert.deepEqual(captured.patch.addTags, ['reservoir']);

  const stop = evaluateRules([
    { ...rules[0]!, id: 'first', name: 'first', priority: 1, stopOnMatch: true, conditions: { keywords: ['anything'] }, actions: { setBucket: 'reference' } },
    { ...rules[1]!, id: 'second', name: 'second', priority: 2, conditions: { keywords: ['anything'] }, actions: { setBucket: 'noise' } },
  ], { content: 'anything', tags: [], bucket: 'idea' });
  assert.deepEqual(stop.matchedRules.map((match) => match.id), ['first']);
  assert.equal(stop.patch.bucket, 'reference');

  const db2 = createDatabase(':memory:');
  db2.prepare("INSERT INTO captures (id, content, created_at, updated_at) VALUES (?,?,?,?)").run('locked', 'Solve the task', 1, 1);
  const leverage = getField(db2, 'leverage')!;
  upsertFieldValue(db2, 'locked', leverage.id, { valueText: '0', valueNum: 0, source: 'human', locked: true });
  syncCaptureFts(db2, 'locked');
  db2.prepare('INSERT INTO rules (id, name, conditions_json, actions_json, priority, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
    .run('force-leverage', 'Force leverage', '{"keywords":["Solve"]}', JSON.stringify({ setFields: { leverage: { valueNum: 3, valueText: '3' } } }), 1, 1, 1);
  assert.equal(previewRuleSweep(db2, undefined, '').affectedCount, 1);
  executeRuleSweep(db2, undefined, '');
  assert.equal(getCapture(db2, 'locked')?.fields.leverage?.valueNum, 0, 'human-locked fields must survive a sweep');
  executeRuleSweep(db2, undefined, '', true);
  assert.equal(getCapture(db2, 'locked')?.fields.leverage?.valueNum, 3, 'explicit overwrite may replace locked fields');
  assert.ok((db2.prepare('SELECT hit_count FROM rules WHERE id = ?').get('force-leverage') as { hit_count: number }).hit_count >= 2);
  db.close(); db2.close();
});

test('seeded OTP rule applies TTL, tags and markTriaged during ingestion', async () => {
  const db = createDatabase(':memory:');
  const result = await ingestCaptureAuto(db, { content: 'your OTP is 123456', skipUrlFetch: true });
  const capture = getCapture(db, result.capture!.id);
  assert.equal(capture?.bucket, 'noise');
  assert.ok(capture?.tags.includes('ephemeral'));
  assert.ok(capture?.expiresAt && capture.expiresAt > Date.now());
  assert.equal(capture?.expireAction, 'trash');
  assert.equal(capture?.triaged, true);
  assert.ok(listCaptures(db, { q: 'has:ttl', status: 'all' }).captures.some((item) => item.id === capture!.id));
  db.close();
});

test('batch ingestion, append/stitch merge, re-extraction and duplicate detection', async () => {
  const db = createDatabase(':memory:');
  const batch = await ingestBatch(db, 'first atomic note\n\nsecond atomic note\n\nthird atomic note');
  assert.equal(batch.created, 3);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM captures').get() as { n: number }).n, 3);

  const first = await ingestCaptureAuto(db, { content: 'i: Reservoir computing #reservoir', skipUrlFetch: true });
  const second = await ingestCaptureAuto(db, { content: 'm: Same reservoir idea #reservoir', skipUrlFetch: true });
  assert.ok(first.capture && second.capture);
  db.prepare('INSERT INTO capture_edges (source_id, target_id, relation, created_at) VALUES (?,?,?,?)').run(first.capture.id, second.capture.id, 'related', Date.now());
  const merged = mergeCaptures(db, { survivorId: first.capture.id, absorbIds: [second.capture.id], mergedContent: 'Reservoir computing, unified' });
  assert.equal(merged?.content, 'Reservoir computing, unified');
  assert.ok(merged?.tags.includes('reservoir'));
  assert.equal((db.prepare('SELECT deleted_at FROM captures WHERE id = ?').get(second.capture.id) as { deleted_at: number }).deleted_at > 0, true);
  const edges = getCaptureDetail(db, first.capture.id)?.edges ?? [];
  assert.equal(edges.length, 0, 'self-loops from the merge must be removed');

  const edited = await reextractEdited(db, first.capture.id, 'i: Updated reservoir #updated tomorrow 9am');
  assert.equal(edited?.content, 'Updated reservoir #updated tomorrow 9am');
  assert.ok(edited?.tags.includes('updated'));
  assert.ok(edited?.reminder?.dueAt);

  const dup = findDuplicates(db, 'Updated reservoir #updated tomorrow 9am');
  assert.ok(dup.length > 0 && dup[0]!.capture.id === first.capture.id);
  const related = findRelatedCaptures(db, first.capture.id);
  assert.ok(Array.isArray(related));
  db.close();
});

test('TTL expiration, soft trash restore and retention purge', async () => {
  const db = createDatabase(':memory:');
  const service = initCapturesService(db);
  const now = Date.now();
  const expiring = await createCaptureManual(db, {
    content: 'expiring OTP', bucket: 'noise', status: 'active', isPinned: false, expiresAt: now - 1000,
    expireAction: 'trash', reminderDueAt: null, fields: {}, links: [],
  });
  const archiving = await createCaptureManual(db, {
    content: 'expiring scratch', bucket: 'idea', status: 'active', isPinned: false, expiresAt: now - 1000,
    expireAction: 'archive', reminderDueAt: null, fields: {}, links: [],
  });
  assert.equal(ttlSweep(db), 2);
  assert.ok(getCapture(db, expiring.capture!.id)?.deletedAt);
  assert.equal(getCapture(db, archiving.capture!.id)?.status, 'archived');
  assert.equal(service.restore(expiring.capture!.id), true);
  assert.equal(getCapture(db, expiring.capture!.id)?.deletedAt, null);
  assert.equal(service.remove(expiring.capture!.id), true);
  assert.equal(service.restore(expiring.capture!.id), true);
  db.prepare('UPDATE captures SET deleted_at = ? WHERE id = ?').run(now - 40 * 86_400_000, expiring.capture!.id);
  assert.ok(runTrashPurge(db) >= 1);
  assert.equal(getCapture(db, expiring.capture!.id), undefined);
  db.close();
});

test('reminder actions reset notified state, count snoozes and schedule recurrence', () => {
  const db = createDatabase(':memory:');
  const service = initCapturesService(db);
  const created = db.prepare('INSERT INTO captures (id, content, created_at, updated_at) VALUES (?,?,?,?)').run('rem1', 'reminder note', 1, 1);
  assert.ok(created.changes);
  upsertReminder(db, 'rem1', { dueAt: Date.now() - 1000, state: 'notified', snoozeCount: 1 });
  service.reminderAction('rem1', 'snooze4');
  assert.equal(getReminder(db, 'rem1')?.state, 'pending');
  assert.equal(getReminder(db, 'rem1')?.snoozeCount, 2);
  assert.ok(getReminder(db, 'rem1')!.dueAt > Date.now());
  service.reminderAction('rem1', 'tomorrow');
  assert.equal(getReminder(db, 'rem1')?.snoozeCount, 3);
  upsertReminder(db, 'rem1', { dueAt: Date.now(), state: 'notified', recurrence: 'daily@08:00' });
  service.reminderAction('rem1', 'done');
  const next = getReminder(db, 'rem1');
  assert.equal(next?.state, 'pending');
  assert.equal(next?.snoozeCount, 0);
  assert.ok(next!.dueAt > Date.now());
  assert.equal(getCapture(db, 'rem1')?.status, 'active');
  db.close();
});


test('extractor compilation and patch importer round trip', async () => {
  const db = createDatabase(':memory:');
  const a = await createCaptureManual(db, {
    content: 'the **mechanism** of reservoir computing', bucket: 'idea', status: 'active', isPinned: false,
    tags: ['reservoir'], reminderDueAt: null, fields: { leverage: { valueNum: 3 } }, links: [],
  });
  const b = await createCaptureManual(db, {
    content: 'linked implementation detail', bucket: 'memory', status: 'active', isPinned: false,
    tags: ['reservoir'], reminderDueAt: null, fields: {}, links: [{ targetId: a.capture!.id, relation: 'refines' }],
  });
  const compiled = compileExtraction(db, { captureIds: [b.capture!.id], includeNeighbors: true });
  assert.equal(compiled.captureCount, 1);
  assert.equal(compiled.neighborCount, 1);
  assert.ok(compiled.text.includes(b.capture!.id));
  assert.ok(compiled.text.includes('[LINKED CONTEXT]'));
  assert.equal(compiled.estimatedTokens, Math.ceil(compiled.text.length / 4));

  const raw = '```json\n' + JSON.stringify({
    updates: [{ id: a.capture!.id, bucket: 'reference', addTags: ['verified'], fields: { actionable: true }, triaged: true }],
    merges: [], newCaptures: [],
  }) + '\n```';
  const preview = previewPatch(db, raw);
  assert.equal(preview.errors.length, 0);
  assert.equal(preview.diffs.length, 1);
  assert.equal(preview.diffs[0]?.after.bucket, 'reference');
  const parsed = parsePatch(raw);
  const result = applyPatch(db, parsed.patch);
  assert.equal(result.affected, 1);
  const updated = getCapture(db, a.capture!.id);
  assert.equal(updated?.bucket, 'reference');
  assert.ok(updated?.tags.includes('verified'));
  assert.equal(updated?.fields.actionable?.source, 'patch');
  assert.equal(updated?.triaged, true);
  assert.equal((getSetting(db, 'inline_syntax_enabled', '')) === 'true', true);
  setSetting(db, 'inline_syntax_enabled', 'false');
  assert.equal(getSetting(db, 'inline_syntax_enabled', ''), 'false');
  db.close();
});
