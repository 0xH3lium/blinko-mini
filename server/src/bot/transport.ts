import type { Bot } from 'grammy';
import { webhookCallback } from 'grammy';
import type { Hono } from 'hono';
import { config } from '../config.js';

let pollingActive = false;

/** Register the Telegram webhook endpoint before API/static routes. */
export function mountWebhookRoute(app: Hono, bot: Bot): void {
  if (config.BOT_MODE !== 'webhook') return;

  app.post(
    config.WEBHOOK_PATH,
    webhookCallback(bot, 'hono', {
      secretToken: config.WEBHOOK_SECRET,
    }),
  );
}

/**
 * Start the selected transport. Polling explicitly clears any old webhook
 * first; webhook mode never calls bot.start().
 */
export async function startBotTransport(bot: Bot): Promise<void> {
  if (config.BOT_MODE === 'webhook') {
    if (!config.WEBHOOK_URL || !config.WEBHOOK_SECRET) {
      throw new Error('WEBHOOK_URL and WEBHOOK_SECRET are required in webhook mode');
    }
    const fullWebhookUrl = `${config.WEBHOOK_URL.replace(/\/$/, '')}${config.WEBHOOK_PATH}`;
    await bot.api.setWebhook(fullWebhookUrl, {
      secret_token: config.WEBHOOK_SECRET,
    });
    console.log(`[Bot] Started in WEBHOOK mode -> ${fullWebhookUrl}`);
    return;
  }

  await bot.api.deleteWebhook({ drop_pending_updates: false });

  pollingActive = true;
  void bot
    .start({
      onStart: (botInfo) => {
        console.log(`[Bot] Started in POLLING mode as @${botInfo.username}`);
      },
    })
    .catch((error: unknown) => {
      pollingActive = false;
      console.error('[Bot] Polling stopped with an error:', error);
    });
}

export async function stopBotTransport(bot: Bot): Promise<void> {
  if (!pollingActive) return;
  pollingActive = false;
  try {
    await bot.stop();
  } catch (error) {
    console.error('[Bot] Failed to stop cleanly:', error);
  }
}
