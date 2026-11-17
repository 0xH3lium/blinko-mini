import { serve } from '@hono/node-server';
import { config } from './config.js';
import { createApp } from './app.js';
import { closeDatabase, getDatabase } from './db/client.js';
import { createBot } from './bot/bot.js';
import { startBotTransport, stopBotTransport } from './bot/transport.js';

async function main(): Promise<void> {
  // Initialize (and migrate) the database before accepting traffic.
  getDatabase();

  const bot = createBot();
  const app = createApp(bot);
  let shuttingDown = false;

  const server = serve(
    {
      fetch: app.fetch,
      port: config.PORT,
    },
    (info) => {
      console.log(`[Server] Blinko-Mini listening on http://localhost:${info.port}`);
      console.log(`[Server] Bot mode: ${config.BOT_MODE}`);
    },
  );

  try {
    await startBotTransport(bot);
  } catch (error) {
    // The API remains useful for the Mini App; surface a precise bot error
    // without taking the whole service down (e.g. a bad/rotated token).
    console.error('[Bot] Failed to initialize transport:', error);
  }

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[Server] Received ${signal}, shutting down...`);

    const forceExit = setTimeout(() => {
      console.error('[Server] Graceful shutdown timed out.');
      process.exit(1);
    }, 8_000);

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
