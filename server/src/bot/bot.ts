import { Bot, InlineKeyboard } from 'grammy';
import type { InlineQueryResult } from 'grammy/types';
import type Database from 'better-sqlite3';
import { config } from '../config.js';
import { getDatabase } from '../db/client.js';
import { listHeads, listReminders, setSetting, type Bucket, type Reminder } from '../db/queries.js';
import { ingestCaptureAuto } from '../engine/pipeline.js';
import { getJevMode } from '../engine/jev.js';
import { parseDueAt, runDeterministic } from '../engine/deterministic.js';
import { initCapturesService } from '../services/captures.service.js';
import { createLoginToken } from '../services/auth.service.js';
import { jevUsageTotals } from '../db/queries.js';

const BUCKET_EMOJI: Record<Bucket, string> = {
  idea: '🤯',
  memory: '🤔',
  reminder: '🙏',
  question: '👀',
  reference: '👌',
  noise: '😎',
};

function fmtTime(ts: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: config.OWNER_TIMEZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(ts));
}

function db(): Database.Database {
  return getDatabase();
}

function captures() {
  return initCapturesService(db());
}

export async function sendSchedulerReminder(
  bot: Bot,
  captureId: string,
  content: string,
  reminder: Reminder,
): Promise<void> {
  const zombie = reminder.snoozeCount >= 3 ? `🧟 Snoozed ${reminder.snoozeCount}×\n` : '';
  const keyboard = new InlineKeyboard()
    .text('Done ✓', `rem:${captureId}:done`)
    .text('Snooze +4h', `rem:${captureId}:snooze4`)
    .row()
    .text('Tomorrow 9am', `rem:${captureId}:tomorrow`)
    .text('Kill', `rem:${captureId}:kill`);
  await bot.api.sendMessage(
    config.OWNER_TELEGRAM_ID,
    `${zombie}⏰ ${content.slice(0, 500)}\nDue ${fmtTime(reminder.dueAt)} (${config.OWNER_TIMEZONE})`,
    { reply_markup: keyboard },
  );
}

export function createBot(): Bot {
  const bot = new Bot(config.BOT_TOKEN);

  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id ?? ctx.messageReaction?.user?.id;
    if (userId !== config.OWNER_TELEGRAM_ID) return;
    await next();
  });

  bot.command(['start', 'help'], async (ctx) => {
    await ctx.reply(
      [
        'BLINKO//OS protocol',
        '',
        'Send text to capture it. Prefixes: !m / !raw (manual bypass), !rem, remind, mem:, idea:, q:, ref:.',
        '#hashtags, dates and URLs are parsed deterministically.',
        '',
        '/web — PC War Room magic link + 8-character code',
        '/remind — pending reminders',
        '/budget — Jev spend + caps',
        '/jevmode auto|off',
        '/heads — decision heads',
        '',
        'React 📌 pin · ✅ resolve · 👎/💩 delete · ⚡ force Jev.',
        'Inline: @yourbot <query> searches FTS5 + Query DSL.',
      ].join('\n'),
    );
  });

  bot.command('web', async (ctx) => {
    const login = createLoginToken(db());
    await ctx.reply(
      `🖥️ PC War Room (valid 60s):\n${login.url}\n\nOr localhost copy-paste code:\n${login.code}`,
      { link_preview_options: { is_disabled: true } },
    );
  });

  bot.command('remind', async (ctx) => {
    const reminders = listRemindersLite(db());
    if (reminders.length === 0) return ctx.reply('No pending reminders.');
    const lines = reminders.slice(0, 20).map(
      (reminder) => `⏰ ${fmtTime(reminder.dueAt)} · ${reminder.captureId.slice(0, 8)} · ${reminder.snoozeCount}×`,
    );
    await ctx.reply(lines.join('\n'));
  });

  bot.command('budget', async (ctx) => {
    const usage = jevUsageTotals(db());
    await ctx.reply(
      [
        `Jev mode: ${getJevMode(db())} · model: ${config.JEV_MODEL}`,
        `Today: ${usage.todayCalls}/${config.JEV_DAILY_CALL_CAP} calls · $${usage.todayUsd.toFixed(4)} / $${config.JEV_DAILY_USD_CAP}`,
        `Month: $${usage.monthUsd.toFixed(4)} / $${config.JEV_MONTHLY_USD_CAP}`,
        `RSS: ${Math.round(process.memoryUsage().rss / 1_048_576)} MB`,
      ].join('\n'),
    );
  });

  bot.command('jevmode', async (ctx) => {
    const arg = (ctx.match ?? '').trim().toLowerCase();
    if (arg !== 'auto' && arg !== 'off') {
      return ctx.reply(`Current: ${getJevMode(db())}\nUse /jevmode auto|off`);
    }
    setSetting(db(), 'jev_mode', arg);
    await ctx.reply(`Jev mode → ${arg}`);
  });

  bot.command('heads', async (ctx) => {
    const heads = listHeads(db()).filter((head) => head.active);
    await ctx.reply(
      heads.map((head) => `${head.name} · ${head.primitive} · H>${head.entropyThreshold.toFixed(2)}`).join('\n') ||
        'No active heads.',
    );
  });

  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) return;
    const result = await ingestCaptureAuto(db(), {
      content: text,
      tgMessageId: ctx.message.message_id,
      tgChatId: ctx.chat.id,
      ...(ctx.message.reply_to_message?.message_id !== undefined
        ? { replyToTgMessageId: ctx.message.reply_to_message.message_id }
        : {}),
    });
    const capture = result.capture;
    if (!capture) return;

    if (result.reminderDueAt) {
      const keyboard = new InlineKeyboard()
        .text('Done ✓', `rem:${capture.id}:done`)
        .text('Cancel', `rem:${capture.id}:kill`);
      await ctx.reply(`⏰ Reminder set for ${fmtTime(result.reminderDueAt)} (${config.OWNER_TIMEZONE})`, {
        reply_markup: keyboard,
        reply_parameters: { message_id: ctx.message.message_id },
      });
      return;
    }

    const bucketHead = listHeads(db(), true).find((head) => head.name === 'bucket');
    const decision = result.bucketDecision;
    if (decision && bucketHead && decision.entropy > bucketHead.entropyThreshold) {
      const keyboard = new InlineKeyboard();
      Object.entries(decision.probs)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .forEach(([bucket, probability]) => {
          keyboard.text(`${bucket} ${Math.round(probability * 100)}%`, `bucket:${capture.id}:${bucket}`);
        });
      await ctx.reply('Bucket uncertain — pick one:', { reply_markup: keyboard });
      return;
    }
    await ctx.react(BUCKET_EMOJI[capture.bucket] as never).catch(() => undefined);
  });

  bot.on('edited_message:text', async (ctx) => {
    const edit = ctx.update.edited_message;
    if (!edit?.text) return;
    const row = db()
      .prepare('SELECT capture_id FROM telegram_messages WHERE tg_message_id = ?')
      .get(edit.message_id) as { capture_id: string } | undefined;
    if (!row) return;
    const parsed = await runDeterministic(edit.text, new Date(), true);
    captures().update(row.capture_id, {
      content: parsed.text,
      ...(parsed.parsedDueAt ? { reminder: { dueAt: parsed.parsedDueAt } } : {}),
    });
  });

  bot.on('message_reaction', async (ctx) => {
    const reaction = ctx.messageReaction;
    if (!reaction) return;
    const added = reaction.new_reaction.filter(
      (item) => !reaction.old_reaction.some((old) => JSON.stringify(old) === JSON.stringify(item)),
    );
    const emojis: string[] = added.map((item) => ('emoji' in item ? item.emoji : ''));
    const row = db()
      .prepare('SELECT capture_id FROM telegram_messages WHERE tg_message_id = ?')
      .get(reaction.message_id) as { capture_id: string } | undefined;
    if (!row) return;
    const capture = captures().get(row.capture_id);
    if (!capture) return;

    if (emojis.includes('📌')) captures().update(capture.id, { isPinned: !capture.isPinned });
    else if (emojis.includes('✅')) captures().update(capture.id, { status: 'resolved' });
    else if (emojis.includes('👎') || emojis.includes('💩')) captures().remove(capture.id);
    else if (emojis.includes('⚡')) {
      await captures().reevaluateWithJev(capture.id);
      await ctx.react('⚡' as never).catch(() => undefined);
    }
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
        if (captureId && op) await handleReminderAction(captureId, op);
        await ctx.answerCallbackQuery({ text: 'Reminder updated' });
      } else {
        await ctx.answerCallbackQuery();
      }
      if (ctx.callbackQuery.message) {
        await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
      }
    } catch (error) {
      console.error('[Bot] callback failed:', error);
      await ctx.answerCallbackQuery({ text: 'Action failed' }).catch(() => undefined);
    }
  });

  bot.on('inline_query', async (ctx) => {
    const query = ctx.inlineQuery.query.trim();
    if (!query) {
      await ctx.answerInlineQuery([]);
      return;
    }
    const page = captures().list({ q: query, status: 'active', limit: 10 });
    const results: InlineQueryResult[] = page.captures.map((capture) => ({
      type: 'article',
      id: capture.id,
      title: `${BUCKET_EMOJI[capture.bucket]} ${capture.content.slice(0, 64)}`,
      description: capture.content.slice(0, 120),
      input_message_content: { message_text: `${BUCKET_EMOJI[capture.bucket]} ${capture.content}` },
    }));
    await ctx.answerInlineQuery(results, { cache_time: 0 });
  });

  bot.catch((error) => {
    console.error('[Bot] Unhandled update error:', error.error);
  });

  return bot;
}

async function handleReminderAction(captureId: string, op: string): Promise<void> {
  const capture = captures().get(captureId);
  const reminder = capture?.reminder;
  if (!capture || !reminder) return;
  if (op === 'done') {
    captures().update(captureId, { status: 'resolved', reminder: { dueAt: reminder.dueAt, state: 'done' } });
  } else if (op === 'kill') {
    captures().update(captureId, { reminder: { dueAt: reminder.dueAt, state: 'killed' } });
  } else if (op === 'snooze4') {
    captures().update(captureId, {
      reminder: { dueAt: Date.now() + 4 * 3_600_000, snoozeCount: reminder.snoozeCount + 1 },
    });
  } else if (op === 'tomorrow') {
    const due = parseDueAt('tomorrow at 9am');
    if (due) captures().update(captureId, { reminder: { dueAt: due, state: 'pending' } });
  }
}

function listRemindersLite(database: Database.Database): Array<{ captureId: string; dueAt: number; snoozeCount: number }> {
  return listReminders(database).map((reminder) => ({
    captureId: reminder.captureId,
    dueAt: reminder.dueAt,
    snoozeCount: reminder.snoozeCount,
  }));
}
