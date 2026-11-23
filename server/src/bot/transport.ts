import type { Bot } from 'grammy';
import { webhookCallback } from 'grammy';
import type { Hono } from 'hono';
import { config } from '../config.js';

const ALLOWED_UPDATES = ['message', 'edited_message', 'message_reaction', 'callback_query', 'inline_query'] as const;

let pollingActive = false;

export function mountWebhookRoute(app: Hono, bot: Bot): void {
  if (config.BOT_MODE !== 'webhook') return;
  app.post(
    config.WEBHOOK_PATH,
    webhookCallback(bot, 'hono', { secretToken: config.WEBHOOK_SECRET }),
  );
}

export async function startBotTransport(bot: Bot): Promise<void> {
  if (config.BOT_MODE === 'webhook') {
    if (!config.WEBHOOK_URL || !config.WEBHOOK_SECRET) {
      throw new Error('WEBHOOK_URL and WEBHOOK_SECRET are required in webhook mode');
    }
    const url = `${config.WEBHOOK_URL.replace(/\/$/, '')}${config.WEBHOOK_PATH}`;
    await bot.api.setWebhook(url, {
      secret_token: config.WEBHOOK_SECRET,
      allowed_updates: [...ALLOWED_UPDATES],
    });
    console.log(`[Bot] WEBHOOK -> ${url}`);
    return;
  }

  await bot.api.deleteWebhook({ drop_pending_updates: false });
  pollingActive = true;
  void bot
    .start({
      allowed_updates: [...ALLOWED_UPDATES],
      onStart: (botInfo) => console.log(`[Bot] POLLING as @${botInfo.username}`),
    })
    .catch((error: unknown) => {
      pollingActive = false;
      console.error('[Bot] Polling stopped:', error);
    });
}

export async function stopBotTransport(bot: Bot): Promise<void> {
  if (!pollingActive) return;
  pollingActive = false;
  await bot.stop().catch((error: unknown) => console.error('[Bot] stop failed:', error));
}
