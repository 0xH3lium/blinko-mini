import { Bot, InlineKeyboard } from 'grammy';
import type { InlineQueryResult } from 'grammy/types';
import { config } from '../config.js';
import { getDatabase } from '../db/client.js';
import {
  getCapture,
  getHeadRow,
  insertEdge,
  listHeads,
  listReminders,
  setSetting,
  type Bucket,
  type Capture,
} from '../db/queries.js';
import { ingestCapture } from '../engine/pipeline.js';
import { evaluateHeads, scoreCollisionPair, canSpendJev, getJevMode } from '../engine/jev.js';
import { vectorIndex } from '../engine/embeddings.js';
import { initCapturesService } from '../services/captures.service.js';
import { createLoginToken } from '../services/auth.service.js';
import { computeEffectiveEnergy } from '../engine/physics.js';
import type { Reminder } from '../db/queries.js';

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

function db() {
  return getDatabase();
}

function captures() {
  return initCapturesService(db());
}

async function sendReminder(captureId: string, content: string, reminder: Reminder, bot: Bot): Promise<void> {
  const zombie = reminder.snoozeCount >= 4 ? `🧟 ZOMBIE TASK (snoozed ${reminder.snoozeCount}×)\n` : '';
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
        'Send any text to capture it. Prefixes: !rem / remind / mem: / idea:',
        '/web — PC War Room magic link + code',
        '/remind — pending reminders',
        '/collide — cross-domain synthesis',
        '/budget — Jev spend + local hit rate',
        '/jevmode gated|bootstrap|off',
        '/heads — decision heads + accuracy',
        '',
        'React 📌 pin · 🔥 boost · ✅ resolve · 👎 delete · ⚡ force Jev',
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
    const reminders = listReminders(db());
    if (reminders.length === 0) return ctx.reply('No pending reminders.');
    const zombies = reminders.filter((reminder) => reminder.snoozeCount >= 4).length;
    const lines = reminders.slice(0, 20).map(
      (reminder) => `⏰ ${fmtTime(reminder.dueAt)} · ${reminder.content.slice(0, 90)}`,
    );
    await ctx.reply(`${zombies > 0 ? `🧟 ${zombies} zombie task(s)\n` : ''}${lines.join('\n')}`);
  });

  bot.command('budget', async (ctx) => {
    const telemetry = await fetchTelemetryLocal();
    await ctx.reply(
      [
        `Jev mode: ${telemetry.jevMode}`,
        `Today: ${telemetry.usageToday}/${telemetry.caps.dailyCalls} calls · $${telemetry.usageTodayUsd.toFixed(4)} / $${telemetry.caps.dailyUsd}`,
        `Month: $${telemetry.usageMonthUsd.toFixed(4)} / $${telemetry.caps.monthlyUsd}`,
        `Local hit: ${Math.round(telemetry.localHitRate * 100)}% · Agreement: ${Math.round(telemetry.agreement * 100)}%`,
        `RSS: ${telemetry.rssMb} MB`,
      ].join('\n'),
    );
  });

  bot.command('jevmode', async (ctx) => {
    const arg = (ctx.match ?? '').trim();
    if (!['gated', 'bootstrap', 'off'].includes(arg)) {
      return ctx.reply(`Current: ${getJevMode(db())}\nUse /jevmode gated|bootstrap|off`);
    }
    setSetting(db(), 'jev_mode', arg);
    await ctx.reply(`Jev mode → ${arg}`);
  });

  bot.command('heads', async (ctx) => {
    const heads = listHeads(db()).filter((head) => head.active);
    const lines = heads.map((head) => {
      const accuracy = head.evalCount > 0 ? `${Math.round((head.agreementCount / head.evalCount) * 100)}%` : '—';
      return `${head.name} · ${head.primitive} · n=${head.sampleCount} · acc=${accuracy}${head.isSystem ? ' · system' : ''}`;
    });
    await ctx.reply(lines.join('\n') || 'No active heads.');
  });

  bot.command('collide', async (ctx) => {
    const active = captures().list({ status: 'active', sort: 'energy', limit: 60 }).captures;
    const byBucket = new Map<Bucket, Capture[]>();
    for (const capture of active) {
      const list = byBucket.get(capture.bucket) ?? [];
      list.push(capture);
      byBucket.set(capture.bucket, list);
    }
    const buckets = [...byBucket.keys()];
    const pairs: Array<[Capture, Capture]> = [];
    for (let i = 0; i < buckets.length && pairs.length < 4; i += 1) {
      const left = byBucket.get(buckets[i]!)?.[0];
      const right = byBucket.get(buckets[(i + 1) % buckets.length]!)?.[0];
      if (left && right && left.id !== right.id) pairs.push([left, right]);
    }
    if (pairs.length === 0) return ctx.reply('Need captures in at least two buckets to collide.');
    let best: { a: Capture; b: Capture; score: number; via: string } | null = null;
    for (const [a, b] of pairs) {
      if (canSpendJev(db()).ok) {
        const result = await scoreCollisionPair(db(), a.content, b.content);
        if (result && (!best || result.score > best.score)) best = { a, b, score: result.score, via: 'Jev' };
      } else {
        const aVector = vectorIndex.get(a.id);
        const bVector = vectorIndex.get(b.id);
        const similarity = aVector && bVector ? Math.max(0, 1 - Math.abs(dot(aVector, bVector))) : 1;
        if (!best || similarity < best.score) best = { a, b, score: similarity, via: 'local distance' };
      }
    }
    if (!best) return ctx.reply('No collision candidate available.');
    const keyboard = new InlineKeyboard()
      .text('Link Ideas', `collide:${best.a.id}:${best.b.id}:link`)
      .text('Dismiss', `collide:${best.a.id}:${best.b.id}:dismiss`);
    await ctx.reply(
      `⚡ Collision (${best.via} ${best.score.toFixed(2)})\n\nA: ${best.a.content.slice(0, 300)}\n\nB: ${best.b.content.slice(0, 300)}`,
      { reply_markup: keyboard },
    );
  });

  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) return;
    const replyTo = ctx.message.reply_to_message?.message_id;
    const result = await ingestCapture(db(), {
      content: text,
      tgMessageId: ctx.message.message_id,
      tgChatId: ctx.chat.id,
      ...(replyTo !== undefined ? { replyToTgMessageId: replyTo } : {}),
    });

    if (result.kind === 'resonance') {
      const age = Math.max(1, Math.round((Date.now() - result.firstSeenAt) / 86_400_000));
      await ctx.reply(`🔁 Resonance ×${result.count} (first seen ${age}d ago). Boosted.`, {
        reply_parameters: { message_id: ctx.message.message_id },
      });
      return;
    }

    const capture = result.captureReturn;
    if (!capture) return;
    if (result.collision) {
      const keyboard = new InlineKeyboard()
        .text('Mark Paradox ⚡', `paradox:${capture.id}:${result.collision.candidateId}`)
        .text('New Wins', `win:${capture.id}:${result.collision.candidateId}:new`)
        .row()
        .text('Old Wins', `win:${capture.id}:${result.collision.candidateId}:old`)
        .text('Ignore', 'ignore');
      await ctx.reply(
        `⚔️ Collision detected:\n"${result.collision.candidateContent.slice(0, 300)}"\nvs\n"${capture.content.slice(0, 300)}"`,
        { reply_markup: keyboard },
      );
      return;
    }

    if (result.reminderDueAt) {
      void ctx.react('🙏' as never).catch(() => undefined);
      const keyboard = new InlineKeyboard()
        .text('Done ✓', `rem:${capture.id}:done`)
        .text('Cancel', `rem:${capture.id}:kill`);
      await ctx.reply(`⏰ Reminder set for ${fmtTime(result.reminderDueAt)} (${config.OWNER_TIMEZONE})`, {
        reply_markup: keyboard,
        reply_parameters: { message_id: ctx.message.message_id },
      });
      return;
    }

    if (capture.bucket === 'idea' && result.bucketPrediction && result.bucketPrediction.confidence < 0.72) {
      const entries = Object.entries(result.bucketPrediction.probs)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);
      const keyboard = new InlineKeyboard();
      entries.forEach(([bucket, probability]) => {
        keyboard.text(`${bucket} ${Math.round(probability * 100)}%`, `bucket:${capture.id}:${bucket}`);
      });
      await ctx.reply('Bucket uncertain — pick one:', { reply_markup: keyboard });
      return;
    }

    void ctx.react(BUCKET_EMOJI[capture.bucket] as never).catch(() => undefined);
  });

  bot.on('edited_message:text', async (ctx) => {
    const edit = ctx.update.edited_message;
    if (!edit?.text) return;
    const row = db()
      .prepare('SELECT capture_id FROM telegram_messages WHERE tg_message_id = ?')
      .get(edit.message_id) as { capture_id: string } | undefined;
    if (!row) return;
    captures().update(row.capture_id, { content: edit.text });
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
    const capture = getCapture(db(), row.capture_id);
    if (!capture) return;

    if (emojis.includes('📌')) {
      captures().update(capture.id, { isPinned: !capture.isPinned });
    } else if (emojis.includes('🔥')) {
      db().prepare('UPDATE captures SET energy = 2.0, last_activated_at = ?, updated_at = ? WHERE id = ?').run(
        Date.now(),
        Date.now(),
        capture.id,
      );
    } else if (emojis.includes('✅')) {
      captures().update(capture.id, { status: 'resolved' });
      db().prepare(`UPDATE reminders SET state = 'done' WHERE capture_id = ?`).run(capture.id);
    } else if (emojis.includes('👎') || emojis.includes('💩')) {
      captures().remove(capture.id);
    } else if (emojis.includes('⚡')) {
      const heads = listHeads(db(), true).map((head) => getHeadRow(db(), head.id)).filter((item): item is NonNullable<typeof item> => !!item);
      await evaluateHeads(db(), capture.content, heads, 'manual');
    }
  });

  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const [action, ...rest] = data.split(':');
    try {
      if (action === 'bucket') {
        const [captureId, bucket] = rest;
        if (captureId && bucket) captures().update(captureId, { bucket: bucket as Bucket });
        await ctx.answerCallbackQuery({ text: 'Bucket trained' });
      } else if (action === 'paradox') {
        const [sourceId, targetId] = rest;
        if (sourceId && targetId) {
          insertEdge(db(), sourceId, targetId, 'paradox', 1, { via: 'human' });
          db().prepare('UPDATE captures SET decay_lambda = 0, updated_at = ? WHERE id IN (?, ?)').run(
            Date.now(),
            sourceId,
            targetId,
          );
          db().prepare('UPDATE captures SET status = ? WHERE id IN (?, ?)').run('active', sourceId, targetId);
        }
        await ctx.answerCallbackQuery({ text: 'Paradox locked' });
      } else if (action === 'win') {
        const [sourceId, targetId, winner] = rest;
        if (sourceId && targetId && winner) {
          captures().update(winner === 'new' ? targetId : sourceId, { status: 'resolved' });
        }
        await ctx.answerCallbackQuery({ text: 'Collision resolved' });
      } else if (action === 'ignore') {
        await ctx.answerCallbackQuery({ text: 'Ignored' });
      } else if (action === 'rem') {
        const [captureId, op] = rest;
        if (captureId && op) await handleReminderAction(captureId, op);
        await ctx.answerCallbackQuery({ text: 'Reminder updated' });
      } else if (action === 'collide') {
        const [a, b, op] = rest;
        if (op === 'link' && a && b) {
          insertEdge(db(), a, b, 'reinforces', 1, { via: 'collide' });
          await ctx.answerCallbackQuery({ text: 'Ideas linked' });
        } else {
          await ctx.answerCallbackQuery({ text: 'Dismissed' });
        }
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
      input_message_content: {
        message_text: `${BUCKET_EMOJI[capture.bucket]} ${capture.content}`,
      },
    }));
    await ctx.answerInlineQuery(results, { cache_time: 0 });
  });

  bot.catch((error) => {
    console.error('[Bot] Unhandled update error:', error.error);
  });

  return bot;
}

async function handleReminderAction(captureId: string, op: string): Promise<void> {
  const now = Date.now();
  if (op === 'done') {
    captures().update(captureId, { status: 'resolved' });
    db().prepare(`UPDATE reminders SET state = 'done' WHERE capture_id = ?`).run(captureId);
  } else if (op === 'kill') {
    db().prepare(`UPDATE reminders SET state = 'killed' WHERE capture_id = ?`).run(captureId);
  } else if (op === 'snooze4') {
    db().prepare(
      `UPDATE reminders SET due_at = ?, state = 'pending', snooze_count = snooze_count + 1 WHERE capture_id = ?`,
    ).run(now + 4 * 3_600_000, captureId);
  } else if (op === 'tomorrow') {
    const tomorrow = new Date(now + 86_400_000);
    const target = new Date(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: config.OWNER_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(tomorrow) + 'T09:00:00+03:30',
    );
    db().prepare(`UPDATE reminders SET due_at = ?, state = 'pending' WHERE capture_id = ?`).run(
      target.getTime(),
      captureId,
    );
  }
}

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}

async function fetchTelemetryLocal(): Promise<{
  jevMode: string;
  usageToday: number;
  usageTodayUsd: number;
  usageMonthUsd: number;
  caps: { dailyCalls: number; dailyUsd: number; monthlyUsd: number };
  localHitRate: number;
  agreement: number;
  rssMb: number;
}> {
  const { jevUsageTotals, localHitRate } = await import('../db/queries.js');
  const usage = jevUsageTotals(db());
  const heads = listHeads(db());
  const totalEval = heads.reduce((sum, head) => sum + head.evalCount, 0);
  const totalAgree = heads.reduce((sum, head) => sum + head.agreementCount, 0);
  return {
    jevMode: getJevMode(db()),
    usageToday: usage.todayCalls,
    usageTodayUsd: usage.todayUsd,
    usageMonthUsd: usage.monthUsd,
    caps: {
      dailyCalls: config.JEV_DAILY_CALL_CAP,
      dailyUsd: config.JEV_DAILY_USD_CAP,
      monthlyUsd: config.JEV_MONTHLY_USD_CAP,
    },
    localHitRate: localHitRate(db()),
    agreement: totalEval > 0 ? totalAgree / totalEval : 0,
    rssMb: Math.round(process.memoryUsage().rss / 1_048_576),
  };
}

export async function sendSchedulerReminder(captureId: string, content: string, reminder: Reminder): Promise<void> {
  const bot = new Bot(config.BOT_TOKEN);
  await sendReminder(captureId, content, reminder, bot);
}

export { computeEffectiveEnergy };
