import { Bot } from 'grammy';
import { config } from '../config.js';
import { getItemsService } from '../services/items.service.js';

export function createBot(): Bot {
  const bot = new Bot(config.BOT_TOKEN);

  // Register this guard first: every update from anyone but the owner is
  // silently dropped before any handler or command can run.
  bot.use(async (ctx, next) => {
    if (ctx.from?.id !== config.OWNER_TELEGRAM_ID) {
      return;
    }
    await next();
  });

  bot.command('start', async (ctx) => {
    await ctx.reply(
      'Blinko-Mini is ready. Send any text to capture a Blink, then open the Mini App to refine it into a Note.',
    );
  });

  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;

    // Leave unhandled commands alone rather than saving them as blinks.
    if (text.startsWith('/')) return;

    const item = getItemsService().create({
      type: 'blink',
      content: text,
    });

    try {
      await ctx.react('👍');
    } catch {
      // Reactions can be unavailable for some bot configurations. The reply
      // below is the guaranteed acknowledgement.
    }

    await ctx.reply(`Saved Blink #${item.id.slice(0, 6)}`, {
      reply_parameters: { message_id: ctx.message.message_id },
    });
  });

  bot.catch((error) => {
    console.error('[Bot] Unhandled update error:', error.error);
  });

  return bot;
}
