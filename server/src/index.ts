import { serve } from '@hono/node-server';
import { config } from './config.js';
import { createApp } from './app.js';
import { closeDatabase, getDatabase } from './db/client.js';
import { createBot } from './bot/bot.js';
import { startBotTransport, stopBotTransport } from './bot/transport.js';
import { startScheduler, stopScheduler } from './engine/scheduler.js';
import { initCapturesService } from './services/captures.service.js';

async function main(): Promise<void> {
  const db = getDatabase();
  initCapturesService(db);

  const bot = createBot();
  const app = createApp(bot);
  let shuttingDown = false;

  const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
    console.log(`[Server] BLINKO//OS listening on http://localhost:${info.port}`);
    console.log(`[Server] Bot mode: ${config.BOT_MODE} · TZ: ${config.OWNER_TIMEZONE}`);
  });

  startScheduler(db, bot);

  try {
    await startBotTransport(bot);
  } catch (error) {
    console.error('[Bot] Failed to initialize transport:', error);
  }

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[Server] ${signal}, shutting down...`);
    const forceExit = setTimeout(() => process.exit(1), 8_000);
    stopScheduler();
    await stopBotTransport(bot);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeDatabase();
    clearTimeout(forceExit);
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  console.error('[Server] Fatal startup error:', error);
  process.exit(1);
});
