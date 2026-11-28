import { Bot, InputFile } from 'grammy';
import type { Context } from 'grammy';
import type { InlineQueryResult } from 'grammy/types';
import type Database from 'better-sqlite3';
import { config } from '../config.js';
import { getDatabase } from '../db/client.js';
import { listReminders, listRules, getAgenda, getSetting, setSetting, type Bucket, type Reminder, type Agenda, BUCKETS } from '../db/queries.js';
import { ingestCaptureAuto, ingestBatch, reextractEdited } from '../engine/pipeline.js';
import { compileExtraction } from '../engine/extractor.js';
import { getTriage } from '../db/queries.js';
import { initCapturesService } from '../services/captures.service.js';
import { createLoginToken } from '../services/auth.service.js';
import {
  BUCKET_EMOJI, captureKeyboard, digestKeyboard, formatTime, reminderKeyboard, renderCaptureCard,
  renderTriageCard, searchKeyboard, splitCallback, triageKeyboard, truncate, undoTrashKeyboard,
} from './keyboards.js';

// ---- per-chat interactive state, persisted so a restart cannot drop a queued /batch ----
interface ChatState { batch?: string[]; pendingSearch?: boolean; searchQuery?: string; triageIndex?: number }
const chats = new Map<number, ChatState>();
function state(chatId: number): ChatState {
  let s = chats.get(chatId);
  if (!s) {
    let saved: ChatState = {};
    try { saved = JSON.parse(getSetting(db(), `bot_chat_state:${chatId}`, '{}')) as ChatState; } catch { /* ignore corrupt state */ }
    const key = `bot_chat_state:${chatId}`;
    const persist = () => setSetting(db(), key, JSON.stringify(saved));
    s = new Proxy(saved, {
      set(target, property, value) { Reflect.set(target, property, value); persist(); return true; },
      deleteProperty(target, property) { Reflect.deleteProperty(target, property); persist(); return true; },
    });
    chats.set(chatId, s);
  }
  return s;
}

function db(): Database.Database { return getDatabase(); }
function captures() { return initCapturesService(db()); }
function timeZone(): string { return getSetting(db(), 'owner_timezone', config.OWNER_TIMEZONE); }
function fmtTime(ts: number): string { return formatTime(ts, timeZone()); }
function chatIdOf(ctx: Context): number { return ctx.chat?.id ?? ctx.from?.id ?? config.OWNER_TELEGRAM_ID; }

// ---------------------------------------------------------------- reminders

export async function sendSchedulerReminder(
  bot: Bot, captureId: string, content: string, reminder: Reminder,
): Promise<void> {
  const zombie = reminder.snoozeCount >= 3 ? `🧟 Snoozed ${reminder.snoozeCount}×\n` : '';
  const recurring = reminder.recurrence ? `↻ ${reminder.recurrence}\n` : '';
  await bot.api.sendMessage(
    config.OWNER_TELEGRAM_ID,
    `${zombie}${recurring}⏰ ${content.slice(0, 500)}\nDue ${fmtTime(reminder.dueAt)}`,
    { reply_markup: reminderKeyboard(captureId) },
  );
}

export async function sendTacticalDigest(bot: Bot, agenda: Agenda): Promise<void> {
  const pinned = db().prepare("SELECT content FROM captures WHERE deleted_at IS NULL AND is_pinned = 1 ORDER BY updated_at DESC LIMIT 5").all() as Array<{ content: string }>;
  const leverage = db().prepare(
    `SELECT COUNT(*) AS count FROM captures c JOIN capture_fields cf ON cf.capture_id = c.id
     JOIN custom_fields f ON f.id = cf.field_id
     WHERE c.deleted_at IS NULL AND c.triaged = 0 AND f.name = 'leverage' AND cf.value_num >= 2`,
  ).get() as { count: number };
  const lines = [
    '📊 TACTICAL DIGEST',
    `Overdue: ${agenda.overdue.length} · Today: ${agenda.today.length} · Upcoming: ${agenda.upcoming.length}`,
    ...agenda.today.slice(0, 8).map((item) => `• ${item.content.slice(0, 80)}`),
    `Pinned: ${pinned.map((item) => item.content.slice(0, 40)).join(' | ') || 'none'}`,
    `High-leverage untriaged: ${leverage.count}`,
  ];
  await bot.api.sendMessage(config.OWNER_TELEGRAM_ID, lines.join('\n'), { reply_markup: digestKeyboard() });
}

// ---------------------------------------------------------------- capture card

async function renderCard(ctx: Context, id: string, edit = true): Promise<void> {
  const capture = captures().get(id);
  if (!capture) { await ctx.answerCallbackQuery({ text: 'Capture not found' }).catch(() => undefined); return; }
  const text = renderCaptureCard(capture, timeZone());
  const markup = { reply_markup: captureKeyboard(capture) };
  if (edit && ctx.callbackQuery?.message) await ctx.editMessageText(text, markup).catch(() => undefined);
  else await ctx.reply(text, markup).catch(() => undefined);
}

async function renderReminder(ctx: Context, id: string): Promise<void> {
  const capture = captures().get(id);
  const r = capture?.reminder;
  const text = r
    ? `⏰ ${truncate(capture?.content ?? '', 200)}\nDue ${fmtTime(r.dueAt)}${r.recurrence ? ` · ↻ ${r.recurrence}` : ''} · snoozed ${r.snoozeCount}× · ${r.state}`
    : `No pending reminder.`;
  const terminal = !r || r.state === 'done' || r.state === 'killed';
  const markup = { reply_markup: terminal ? undefined : reminderKeyboard(id) };
  if (ctx.callbackQuery?.message) await ctx.editMessageText(text, markup).catch(() => undefined);
  else await ctx.reply(text, markup);
}

// ---------------------------------------------------------------- triage

async function renderTriage(ctx: Context, edit = true): Promise<void> {
  const chatId = chatIdOf(ctx);
  const s = state(chatId);
  const triage = getTriage(db());
  const total = triage.untriaged.length;
  if (total === 0) {
    s.triageIndex = 0;
    const text = '🎉 Inbox zero — nothing to triage.';
    const markup = { reply_markup: undefined };
    if (edit && ctx.callbackQuery?.message) await ctx.editMessageText(text, markup).catch(() => undefined);
    else await ctx.reply(text);
    return;
  }
  const index = Math.max(0, Math.min(s.triageIndex ?? 0, total - 1));
  s.triageIndex = index;
  const capture = triage.untriaged[index]!;
  const text = renderTriageCard(capture, index, total, timeZone());
  const markup = { reply_markup: triageKeyboard(capture.id, index, total) };
  if (edit && ctx.callbackQuery?.message) await ctx.editMessageText(text, markup).catch(() => undefined);
  else await ctx.reply(text, markup);
}

// ---------------------------------------------------------------- search

const SEARCH_PAGE = 5;

async function renderSearch(ctx: Context, query: string, page: number, edit = true): Promise<void> {
  const s = state(chatIdOf(ctx));
  s.searchQuery = query;
  const result = captures().list({ q: query, status: 'active', limit: SEARCH_PAGE, offset: page * SEARCH_PAGE, sort: 'recent' });
  const safePage = result.total === 0 ? 0 : Math.min(page, Math.max(0, Math.ceil(result.total / SEARCH_PAGE) - 1));
  const repaged = safePage !== page
    ? captures().list({ q: query, status: 'active', limit: SEARCH_PAGE, offset: safePage * SEARCH_PAGE, sort: 'recent' })
    : result;
  const header = `🔍 "${truncate(query, 40)}" · ${repaged.total} match${repaged.total === 1 ? '' : 'es'}`;
  const body = repaged.captures.map((c, i) => `${safePage * SEARCH_PAGE + i + 1}. ${truncate(c.content, 80)}`).join('\n') || 'No matches.';
  const text = `${header}\n${body}`;
  const markup = { reply_markup: searchKeyboard(repaged.captures, safePage, SEARCH_PAGE, repaged.total) };
  if (edit && ctx.callbackQuery?.message) await ctx.editMessageText(text, markup).catch(() => undefined);
  else await ctx.reply(text, markup);
}

// ---------------------------------------------------------------- callbacks

type ReminderOp = 'done' | 'snooze1' | 'snooze4' | 'tomorrow' | 'week' | 'kill';

async function answer(ctx: Context, text?: string): Promise<void> {
  await ctx.answerCallbackQuery(text ? { text } : undefined).catch(() => undefined);
}

async function handleCap(ctx: Context, id: string, op: string, arg?: string): Promise<void> {
  const svc = captures();
  const capture = svc.get(id);
  if (!capture) { await answer(ctx, 'Capture not found'); return; }

  switch (op) {
    case 'open':
      await answer(ctx);
      await renderCard(ctx, id);
      return;
    case 'close':
      await answer(ctx);
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
      return;
    case 'pin':
      svc.update(id, { isPinned: !capture.isPinned });
      await answer(ctx, capture.isPinned ? 'Unpinned' : 'Pinned');
      break;
    case 'triage':
      svc.update(id, { triaged: !capture.triaged });
      await answer(ctx, capture.triaged ? 'Marked untriaged' : 'Triaged');
      break;
    case 'resolve':
      svc.update(id, { status: capture.status === 'resolved' ? 'active' : 'resolved' });
      await answer(ctx, capture.status === 'resolved' ? 'Reopened' : 'Resolved');
      break;
    case 'trash':
      svc.remove(id);
      await answer(ctx, 'Trashed — tap Undo to restore');
      await ctx.editMessageText(`🗑 Trashed: ${truncate(capture.content, 200)}`, { reply_markup: undoTrashKeyboard(id) }).catch(() => undefined);
      return;
    case 'restore':
      svc.restore(id);
      await answer(ctx, 'Restored');
      break;
    case 'bucket': {
      const bucket = arg as Bucket;
      if (!BUCKETS.includes(bucket)) { await answer(ctx, 'Invalid bucket'); return; }
      svc.update(id, { bucket });
      await answer(ctx, `→ ${bucket}`);
      break;
    }
    case 'leverage': {
      const current = capture.fields.leverage?.valueNum ?? 0;
      const next = current >= 3 ? 0 : current + 1;
      svc.update(id, { fields: { leverage: { valueNum: next, valueText: String(next), source: 'human' } } });
      await answer(ctx, `Leverage ${next}`);
      break;
    }
    case 'remind':
      if (!capture.reminder) {
        const hours = Number(getSetting(db(), 'default_reminder_hours', '4'));
        svc.update(id, { reminder: { dueAt: Date.now() + (Number.isFinite(hours) ? hours : 4) * 3_600_000 } });
      }
      await answer(ctx);
      await renderReminder(ctx, id);
      return;
    default:
      await answer(ctx);
      return;
  }
  await renderCard(ctx, id);
}

async function handleReminderOp(ctx: Context, id: string, op: ReminderOp): Promise<void> {
  const updated = captures().reminderAction(id, op);
  const r = updated?.reminder;
  const label = op === 'kill' ? 'Killed' : op === 'done' ? 'Done' : `Snoozed → ${r ? fmtTime(r.dueAt) : ''}`;
  await answer(ctx, label);
  await renderReminder(ctx, id);
}

async function handleTriage(ctx: Context, rest: string[]): Promise<void> {
  const s = state(chatIdOf(ctx));
  const [op = '', arg, id] = rest;
  if (op === 'noop') { await answer(ctx); return; }
  if (op === 'start') { s.triageIndex = 0; await answer(ctx); await renderTriage(ctx); return; }
  if (op === 'exit') { await answer(ctx); await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined); return; }

  const svc = captures();
  const total = getTriage(db()).untriaged.length;

  if (op === 'bucket') {
    const bucket = arg as Bucket;
    const captureId = id;
    if (captureId && BUCKETS.includes(bucket)) svc.update(captureId, { bucket, triaged: true });
    s.triageIndex = Math.min(s.triageIndex ?? 0, Math.max(0, total - 1));
    await answer(ctx, `→ ${bucket}`);
    await renderTriage(ctx);
    return;
  }

  const captureId = arg;
  if (op === 'triaged' && captureId) { svc.update(captureId, { triaged: true }); await answer(ctx, 'Triaged'); }
  else if (op === 'trash' && captureId) { svc.remove(captureId); await answer(ctx, 'Trashed'); }
  else if (op === 'skip') { s.triageIndex = (s.triageIndex ?? 0) + 1; await answer(ctx); }
  else if (op === 'prev') { s.triageIndex = Math.max(0, (s.triageIndex ?? 0) - 1); await answer(ctx); }
  else if (op === 'next') { s.triageIndex = (s.triageIndex ?? 0) + 1; await answer(ctx); }

  // total re-queried inside renderTriage; clamp after mutation
  await renderTriage(ctx);
}

// ---------------------------------------------------------------- reminders list

async function renderReminderList(ctx: Context): Promise<void> {
  const reminders = listReminders(db());
  if (reminders.length === 0) { await ctx.reply('No pending reminders.'); return; }
  const tz = timeZone();
  const svc = captures();
  // one compact, fully-actionable card per reminder
  for (const reminder of reminders.slice(0, 10)) {
    const content = svc.get(reminder.captureId)?.content ?? '';
    const meta = `⏰ ${formatTime(reminder.dueAt, tz)}${reminder.recurrence ? ` · ↻ ${reminder.recurrence}` : ''} · ${reminder.snoozeCount}× · ${reminder.state}`;
    await ctx.reply(`${meta}\n${truncate(content, 200)}`, { reply_markup: reminderKeyboard(reminder.captureId) });
  }
}

// ---------------------------------------------------------------- bot

export function createBot(): Bot {
  const bot = new Bot(config.BOT_TOKEN);

  // Single-owner lock.
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id ?? ctx.messageReaction?.user?.id;
    if (userId !== config.OWNER_TELEGRAM_ID) return;
    await next();
  });

  bot.command(['start', 'help'], async (ctx) => {
    await ctx.reply([
      'BLINKO//OS v2 · zero-model deterministic war room',
      '',
      '📝 Just send text → atomic capture (buttons on every save).',
      'Prefixes: i:/idea:, m:/mem:, q:, r:/ref:, n:/noise:, !rem · ++ append · ^ link · !pin · !ttl 15m · !every day 8am · !L3 · !act · #tags',
      '',
      'Commands:',
      '/inbox — interactive one-at-a-time triage',
      '/triage — inbox / stubs / bursts / stale counts',
      '/remind — live reminder cards',
      '/digest — tactical briefing',
      '/search <q> — query DSL, paginated (or /search then type)',
      '/batch — collect notes, /done to save all, /cancel to abort (or /batch + blank-line notes)',
      '/extract [slug] [query] — compiled prompt as Markdown',
      '/rules — active rules and hit counts',
      '/web — magic link + 8-char code',
      '/cancel — clear pending input / batch mode',
      '',
      'Reactions on any capture: 📌 pin · ✅ resolve · 👎/💩 trash · 🔥 leverage=3 · 👌 triaged',
      'Every capture message has inline buttons: bucket · pin · triage · resolve · trash+undo · leverage · remind.',
    ].join('\n'));
  });

  bot.command('web', async (ctx) => {
    const login = createLoginToken(db());
    await ctx.reply(`🖥️ PC War Room (valid 60s):\n${login.url}\n\nOr code:\n${login.code}`, {
      link_preview_options: { is_disabled: true },
    });
  });

  bot.command('remind', async (ctx) => { await renderReminderList(ctx); });

  bot.command('digest', async (ctx) => { await sendTacticalDigest(bot, getAgenda(db())); });

  bot.command('rules', async (ctx) => {
    const rules = listRules(db()).filter((rule) => rule.enabled);
    await ctx.reply(
      rules.map((rule) => `#${rule.priority} ${rule.name} · ${rule.hitCount} hits`).join('\n') || 'No active rules.',
    );
  });

  bot.command('triage', async (ctx) => {
    const triage = getTriage(db());
    const kb = triage.untriaged.length > 0
      ? { reply_markup: { inline_keyboard: [[{ text: '📥 Start triage', callback_data: 'tri:start' }]] } }
      : {};
    await ctx.reply(
      `Inbox: ${triage.untriaged.length} · Stubs: ${triage.stubs.length} · Bursts: ${triage.bursts.length} · Stale: ${triage.stale.length}`,
      kb,
    );
  });

  bot.command('inbox', async (ctx) => {
    state(chatIdOf(ctx)).triageIndex = 0;
    await renderTriage(ctx, false);
  });

  // ---- search ----
  bot.command('search', async (ctx) => {
    const q = (ctx.match ?? '').trim();
    if (!q) {
      state(chatIdOf(ctx)).pendingSearch = true;
      await ctx.reply('🔍 Send your query (Query DSL: b:idea #tag due:today leverage>=2 …). /cancel to abort.');
      return;
    }
    await renderSearch(ctx, q, 0, false);
  });

  // ---- extract ----
  bot.command('extract', async (ctx) => {
    const [slug, ...rest] = (ctx.match ?? '').trim().split(/\s+/);
    try {
      const compiled = compileExtraction(db(), { templateId: slug || undefined, q: rest.join(' '), limit: 100 });
      await ctx.replyWithDocument(new InputFile(Buffer.from(compiled.text, 'utf8'), 'blinko-extract.md'), {
        caption: `${compiled.captureCount} captures · ~${compiled.estimatedTokens} tokens`,
      });
    } catch (error) {
      await ctx.reply(error instanceof Error ? error.message : 'Extraction failed');
    }
  });

  // ---- batch mode ----
  bot.command('batch', async (ctx) => {
    const raw = (ctx.match ?? '').trim();
    if (raw) { await ingestBatchInline(ctx, raw); return; }
    const s = state(chatIdOf(ctx));
    s.batch = [];
    await ctx.reply('📦 Batch mode ON. Send notes (one per message or blank-line separated). /done to save all, /cancel to abort.');
  });

  bot.command('done', async (ctx) => {
    const s = state(chatIdOf(ctx));
    if (s.batch === undefined) { await ctx.reply('Not in batch mode. /batch to start.'); return; }
    const notes = s.batch.join('\n\n');
    s.batch = undefined;
    if (!notes.trim()) { await ctx.reply('Nothing to save.'); return; }
    await ingestBatchInline(ctx, notes);
  });

  bot.command('cancel', async (ctx) => {
    const s = state(chatIdOf(ctx));
    s.batch = undefined;
    s.pendingSearch = undefined;
    await ctx.reply('Cleared.');
  });

  // ---- capture ingestion ----
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) return;
    const s = state(chatIdOf(ctx));

    // interactive search: consume next message as query
    if (s.pendingSearch) {
      s.pendingSearch = undefined;
      await renderSearch(ctx, text.trim(), 0, false);
      return;
    }

    // batch mode: collect notes
    if (s.batch !== undefined) {
      s.batch = [...s.batch, text.trim()];
      await ctx.reply(`📦 +1 (${s.batch.length} queued). /done to save, /cancel to abort.`).catch(() => undefined);
      return;
    }

    const forwarded = (ctx.message as { forward_origin?: unknown }).forward_origin;
    const result = await ingestCaptureAuto(db(), {
      content: text,
      tgMessageId: ctx.message.message_id,
      tgChatId: ctx.chat.id,
      ...(ctx.message.reply_to_message?.message_id !== undefined ? { replyToTgMessageId: ctx.message.reply_to_message.message_id } : {}),
      ...(forwarded ? { forwarded: forwarded as Record<string, unknown> } : {}),
    });
    const capture = result.capture;
    if (!capture) return;
    await ctx.react(result.appended ? '➕' as never : BUCKET_EMOJI[capture.bucket] as never).catch(() => undefined);

    if (result.appended) {
      await ctx.reply(`➕ Appended to last capture.`, { reply_parameters: { message_id: ctx.message.message_id } });
      return;
    }
    const capture2 = captures().get(capture.id) ?? capture;
    const notes: string[] = [];
    if (capture.expiresAt) notes.push(`⏳ auto-expires in ${Math.max(1, Math.round((capture.expiresAt - Date.now()) / 60_000))}m`);
    if (result.reminderDueAt) notes.push(`⏰ reminder ${fmtTime(result.reminderDueAt)}`);
    const headline = `${BUCKET_EMOJI[capture.bucket]} ${capture.bucket} · saved${notes.length ? ` · ${notes.join(' · ')}` : ''}`;
    await ctx.reply(headline, {
      reply_markup: captureKeyboard(capture2),
      reply_parameters: { message_id: ctx.message.message_id },
    });
  });

  bot.on('edited_message:text', async (ctx) => {
    const edit = ctx.update.edited_message;
    if (!edit?.text) return;
    const row = db().prepare('SELECT capture_id FROM telegram_messages WHERE tg_message_id = ?').get(edit.message_id) as { capture_id: string } | undefined;
    if (!row) return;
    await reextractEdited(db(), row.capture_id, edit.text);
    await ctx.react('✏️' as never).catch(() => undefined);
  });

  // ---- emoji reactions ----
  bot.on('message_reaction', async (ctx) => {
    const reaction = ctx.messageReaction;
    if (!reaction) return;
    const oldKeys = new Set(reaction.old_reaction.map((item) => JSON.stringify(item)));
    const added = reaction.new_reaction.filter((item) => !oldKeys.has(JSON.stringify(item)));
    const emojis: string[] = added.map((item) => ('emoji' in item ? item.emoji : ''));
    const row = db().prepare('SELECT capture_id FROM telegram_messages WHERE tg_message_id = ?').get(reaction.message_id) as { capture_id: string } | undefined;
    if (!row) return;
    const svc = captures();
    const capture = svc.get(row.capture_id);
    if (!capture) return;
    if (emojis.includes('📌')) svc.update(capture.id, { isPinned: !capture.isPinned });
    else if (emojis.includes('✅')) svc.update(capture.id, { status: 'resolved' });
    else if (emojis.includes('👎') || emojis.includes('💩')) svc.remove(capture.id);
    else if (emojis.includes('🔥')) svc.update(capture.id, { fields: { leverage: { valueNum: 3, valueText: '3', source: 'human' } } });
    else if (emojis.includes('👌')) svc.update(capture.id, { triaged: true });
  });

  // ---- callback router ----
  bot.on('callback_query:data', async (ctx) => {
    const { action, rest } = splitCallback(ctx.callbackQuery.data);
    try {
      if (action === 'noop' || action === 'tri' && rest[0] === 'noop') { await answer(ctx); return; }
      if (action === 'cap') {
        const [id, op, arg] = rest;
        if (id && op) await handleCap(ctx, id, op, arg);
        else await answer(ctx);
      } else if (action === 'bucket') {
        // legacy callback shape
        const [id, bucket] = rest;
        if (id && bucket && BUCKETS.includes(bucket as Bucket)) {
          captures().update(id, { bucket: bucket as Bucket });
          await answer(ctx, 'Bucket updated');
          await renderCard(ctx, id);
        } else await answer(ctx);
      } else if (action === 'rem') {
        const [id, op] = rest;
        if (id && op) await handleReminderOp(ctx, id, op as ReminderOp);
        else await answer(ctx);
      } else if (action === 'tri') {
        await handleTriage(ctx, rest);
      } else if (action === 'srch') {
        const [op, arg] = rest;
        if (op === 'open' && arg) {
          await answer(ctx);
          await renderCard(ctx, arg, false);
        } else if (op === 'page') {
          const page = Math.max(0, Number.parseInt(arg ?? '0', 10) || 0);
          const query = state(chatIdOf(ctx)).searchQuery ?? '';
          await answer(ctx);
          await renderSearch(ctx, query, page, true);
        } else await answer(ctx);
      } else if (action === 'dig' && rest[0] === 'refresh') {
        await answer(ctx);
        await sendTacticalDigest(bot, getAgenda(db()));
      } else if (action === 'cmd' && rest[0] === 'remind') {
        await answer(ctx);
        await renderReminderList(ctx);
      } else await answer(ctx);
    } catch (error) {
      console.error('[Bot] callback failed:', error);
      await answer(ctx, 'Action failed');
    }
  });

  // ---- inline mode ----
  bot.on('inline_query', async (ctx) => {
    const query = ctx.inlineQuery.query.trim();
    if (!query) { await ctx.answerInlineQuery([]); return; }
    const page = captures().list({ q: query, status: 'active', limit: 10 });
    const results: InlineQueryResult[] = page.captures.map((capture) => ({
      type: 'article', id: capture.id,
      title: `${BUCKET_EMOJI[capture.bucket]} ${capture.content.slice(0, 64)}`,
      description: capture.content.slice(0, 120),
      input_message_content: { message_text: `${BUCKET_EMOJI[capture.bucket]} ${capture.content}` },
    }));
    await ctx.answerInlineQuery(results, { cache_time: 0 });
  });

  bot.catch((error) => console.error('[Bot] Unhandled update error:', error.error));
  return bot;
}

async function ingestBatchInline(ctx: Context, raw: string): Promise<void> {
  const result = await ingestBatch(db(), raw);
  if (result.created === 0) { await ctx.reply('Nothing to save.'); return; }
  await ctx.reply(`📦 Saved ${result.created} atomic capture${result.created === 1 ? '' : 's'}.`, {
    reply_markup: { inline_keyboard: [[{ text: '📥 Triage inbox', callback_data: 'tri:start' }]] },
  });
}
