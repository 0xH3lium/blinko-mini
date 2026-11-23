import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Bot } from 'grammy';
import { config } from './config.js';
import { getDatabase } from './db/client.js';
import { authRoutes } from './routes/auth.js';
import { apiRoutes } from './routes/api.js';
import { mountWebhookRoute } from './bot/transport.js';
import { initCapturesService } from './services/captures.service.js';
import { hydrateVectorIndex } from './engine/embeddings.js';
import { cleanupExpiredTokens } from './services/auth.service.js';

const webDist = resolve(config.PROJECT_ROOT, 'web/dist');
const indexHtml = resolve(webDist, 'index.html');

export function createApp(bot?: Bot): Hono {
  const db = getDatabase();
  initCapturesService(db);
  hydrateVectorIndex(db);
  cleanupExpiredTokens(db);

  const app = new Hono();

  // 1. Telegram webhook (webhook mode only).
  if (bot) mountWebhookRoute(app, bot);

  // 2. Magic-link / code auth.
  app.route('/auth', authRoutes);

  // 3. REST + SSE API (health is public, everything else is session-gated).
  app.route('/api', apiRoutes);

  // 4. Static PC panel assets.
  app.use('*', serveStatic({ root: webDist }));

  // 5. SPA fallback.
  app.get('*', async (c) => {
    if (c.req.path === '/api' || c.req.path.startsWith('/api/')) {
      return c.json({ error: 'API route not found' }, 404);
    }
    if (c.req.path === '/auth' || c.req.path.startsWith('/auth/')) {
      return c.json({ error: 'Auth route not found' }, 404);
    }
    try {
      return c.html(await readFile(indexHtml, 'utf8'));
    } catch {
      return c.text('Blinko-OS API is running. Build the web panel with "npm run build".', 503);
    }
  });

  return app;
}
