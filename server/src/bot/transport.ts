import type { Bot } from 'grammy';
import { webhookCallback } from 'grammy';
import type { Hono } from 'hono';
import { config } from '../config.js';

const ALLOWED_UPDATES = ['message', 'edited_message', 'message_reaction', 'callback_query', 'inline_query'] as const;

// Telegram command menu (native picker + autocomplete). Keep in sync with bot.command(...).
const BOT_COMMANDS = [
  { command: 'help', description: 'How it works + interactive controls' },
  { command: 'inbox', description: 'Interactive one-at-a-time triage' },
  { command: 'triage', description: 'Inbox / stubs / bursts / stale counts' },
  { command: 'remind', description: 'Live reminder cards' },
  { command: 'digest', description: 'Tactical briefing' },
  { command: 'search', description: 'Query DSL search, paginated' },
  { command: 'batch', description: 'Collect notes; /done to save all' },
  { command: 'done', description: 'Save queued batch notes' },
  { command: 'cancel', description: 'Clear pending input / batch' },
  { command: 'extract', description: 'Compiled prompt as Markdown' },
  { command: 'rules', description: 'Active rules + hit counts' },
  { command: 'web', description: 'PC War Room magic link + code' },
] as const;

let pollingActive = false;

export function mountWebhookRoute(app: Hono, bot: Bot): void {
  if (config.BOT_MODE !== 'webhook') return;
  app.post(
    config.WEBHOOK_PATH,
    webhookCallback(bot, 'hono', { secretToken: config.WEBHOOK_SECRET }),
  );
}

/** Register the native command menu + chat menu button. Best-effort: never blocks startup. */
async function registerCommands(bot: Bot): Promise<void> {
  try {
    await bot.api.setMyCommands([...BOT_COMMANDS]);
    await bot.api.setChatMenuButton({ menu_button: { type: 'commands' } });
  } catch (error) {
    console.error('[Bot] setMyCommands failed:', error);
  }
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
      drop_pending_updates: false,
    });
    await registerCommands(bot);
    console.log(`[Bot] WEBHOOK -> ${url}`);
    return;
  }

  await bot.api.deleteWebhook({ drop_pending_updates: false });
  await registerCommands(bot);
  pollingActive = true;
  void bot
    .start({
      allowed_updates: [...ALLOWED_UPDATES],
      drop_pending_updates: false,
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
