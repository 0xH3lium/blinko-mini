import { Bot, InlineKeyboard, InputFile } from 'grammy';
import type { InlineQueryResult } from 'grammy/types';
import type Database from 'better-sqlite3';
import { config } from '../config.js';
import { getDatabase } from '../db/client.js';
import { listReminders, listRules, getAgenda, getSetting, type Bucket, type Reminder, type Agenda } from '../db/queries.js';
import { ingestCaptureAuto, reextractEdited } from '../engine/pipeline.js';
import { compileExtraction } from '../engine/extractor.js';
import { getTriage } from '../db/queries.js';
import { initCapturesService } from '../services/captures.service.js';
import { createLoginToken } from '../services/auth.service.js';

const BUCKET_EMOJI: Record<Bucket, string> = {
  idea: '🤯', memory: '🤔', reminder: '🙏', question: '👀', reference: '👌', noise: '😎',
};

function fmtTime(ts: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: getSetting(getDatabase(), 'owner_timezone', config.OWNER_TIMEZONE),
    dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(ts));
}

function db(): Database.Database { return getDatabase(); }
function captures() { return initCapturesService(db()); }

function reminderKeyboard(captureId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('Done ✓', `rem:${captureId}:done`)
    .text('Snooze +1h', `rem:${captureId}:snooze1`)
    .text('+4h', `rem:${captureId}:snooze4`)
    .row()
    .text('Tomorrow 9am', `rem:${captureId}:tomorrow`)
    .text('+1w', `rem:${captureId}:week`)
    .text('Kill', `rem:${captureId}:kill`);
}

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
  await bot.api.sendMessage(config.OWNER_TELEGRAM_ID, lines.join('\n'));
}

export function createBot(): Bot {
  const bot = new Bot(config.BOT_TOKEN);

  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id ?? ctx.messageReaction?.user?.id;
    if (userId !== config.OWNER_TELEGRAM_ID) return;
    await next();
  });

  bot.command(['start', 'help'], async (ctx) => {
    await ctx.reply([
      'BLINKO//OS v2 · zero-model deterministic war room',
      '',
      'Prefixes: i:/idea:, m:/mem:, q:, r:/ref:, n:/noise:, !rem · ++ append · ^ link · !pin · !ttl 15m · !every day 8am · !L3 · !act · #tags',
      '/web — magic link + 8-char code',
      '/remind — reminders with recurrence badge',
      '/digest — instant tactical briefing',
      '/extract [slug] [query] — compiled prompt as Markdown',
      '/batch — then blank-line-separated notes',
      '/rules — active rules and hit counts',
      '/triage — inbox / stubs / bursts counts',
      '',
      'Reactions: 📌 pin · ✅ resolve · 👎/💩 trash · 🔥 leverage=3 · 👌 triaged',
    ].join('\n'));
  });

  bot.command('web', async (ctx) => {
    const login = createLoginToken(db());
    await ctx.reply(`🖥️ PC War Room (valid 60s):\n${login.url}\n\nOr code:\n${login.code}`, {
      link_preview_options: { is_disabled: true },
    });
  });

  bot.command('remind', async (ctx) => {
    const reminders = listReminders(db());
    if (reminders.length === 0) return ctx.reply('No pending reminders.');
    const lines = reminders.slice(0, 25).map((reminder) =>
      `⏰ ${fmtTime(reminder.dueAt)} · ${reminder.captureId.slice(0, 8)} · ${reminder.snoozeCount}×${reminder.recurrence ? ` · ↻ ${reminder.recurrence}` : ''}`);
    await ctx.reply(lines.join('\n'));
  });

  bot.command('digest', async (ctx) => {
    await sendTacticalDigest(bot, getAgenda(db()));
  });

  bot.command('rules', async (ctx) => {
    const rules = listRules(db()).filter((rule) => rule.enabled);
    await ctx.reply(
      rules.map((rule) => `#${rule.priority} ${rule.name} · ${rule.hitCount} hits`).join('\n') || 'No active rules.',
    );
  });

  bot.command('triage', async (ctx) => {
    const triage = getTriage(db());
    await ctx.reply(`Inbox: ${triage.untriaged.length} · Stubs: ${triage.stubs.length} · Bursts: ${triage.bursts.length} · Stale: ${triage.stale.length}`);
  });

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

  bot.command('batch', async (ctx) => {
    const raw = (ctx.match ?? '').trim();
    if (!raw) {
      await ctx.reply('Send /batch followed by a blank line and your notes separated by blank lines.');
      return;
    }
    const notes = raw.split(/\n\s*\n/).map((note) => note.trim()).filter(Boolean);
    await ctx.reply(`Ingesting ${notes.length} atomic captures…`);
    for (const note of notes) {
      const result = await ingestCaptureAuto(db(), { content: note, skipUrlFetch: true });
      if (result.capture) await ctx.react(BUCKET_EMOJI[result.capture.bucket] as never).catch(() => undefined);
    }
  });

  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) return;
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
    if (capture.expiresAt) {
      await ctx.reply(`⏳ Auto-expires in ${Math.max(1, Math.round((capture.expiresAt - Date.now()) / 60_000))}m`, {
        reply_parameters: { message_id: ctx.message.message_id },
      });
    } else if (result.reminderDueAt && !result.appended) {
      await ctx.reply(`⏰ Reminder set for ${fmtTime(result.reminderDueAt)}`, {
        reply_markup: reminderKeyboard(capture.id),
        reply_parameters: { message_id: ctx.message.message_id },
      });
    }
  });

  bot.on('edited_message:text', async (ctx) => {
    const edit = ctx.update.edited_message;
    if (!edit?.text) return;
    const row = db().prepare('SELECT capture_id FROM telegram_messages WHERE tg_message_id = ?').get(edit.message_id) as { capture_id: string } | undefined;
    if (!row) return;
    await reextractEdited(db(), row.capture_id, edit.text);
    await ctx.react('✏️' as never).catch(() => undefined);
  });

  bot.on('message_reaction', async (ctx) => {
    const reaction = ctx.messageReaction;
    if (!reaction) return;
    const added = reaction.new_reaction.filter(
      (item) => !reaction.old_reaction.some((old) => JSON.stringify(old) === JSON.stringify(item)),
    );
    const emojis: string[] = added.map((item) => ('emoji' in item ? item.emoji : ''));
    const row = db().prepare('SELECT capture_id FROM telegram_messages WHERE tg_message_id = ?').get(reaction.message_id) as { capture_id: string } | undefined;
    if (!row) return;
    const capture = captures().get(row.capture_id);
    if (!capture) return;
    if (emojis.includes('📌')) captures().update(capture.id, { isPinned: !capture.isPinned });
    else if (emojis.includes('✅')) captures().update(capture.id, { status: 'resolved' });
    else if (emojis.includes('👎') || emojis.includes('💩')) captures().remove(capture.id);
    else if (emojis.includes('🔥')) captures().update(capture.id, { fields: { leverage: { valueNum: 3, valueText: '3', source: 'human' } } });
    else if (emojis.includes('👌')) captures().update(capture.id, { triaged: true });
  });

  bot.on('callback_query:data', async (ctx) => {
    const [action, ...rest] = ctx.callbackQuery.data.split(':');
    try {
      if (action === 'bucket') {
        const [captureId, bucket] = rest;
        if (captureId && bucket) captures().update(captureId, { bucket: bucket as Bucket });
        await ctx.answerCallbackQuery({ text: 'Bucket updated' });
      } else if (action === 'rem') {
        const [captureId, op] = rest;
        if (captureId && op) captures().reminderAction(captureId, op as ReminderOp);
        await ctx.answerCallbackQuery({ text: 'Reminder updated' });
      } else await ctx.answerCallbackQuery();
      if (ctx.callbackQuery.message) await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
    } catch (error) {
      console.error('[Bot] callback failed:', error);
      await ctx.answerCallbackQuery({ text: 'Action failed' }).catch(() => undefined);
    }
  });

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

type ReminderOp = 'done' | 'snooze1' | 'snooze4' | 'tomorrow' | 'week' | 'kill';
