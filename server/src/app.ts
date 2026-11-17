import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Bot } from 'grammy';
import { config } from './config.js';
import { apiRoutes } from './routes/api.js';
import { mountWebhookRoute } from './bot/transport.js';

const webDist = resolve(config.PROJECT_ROOT, 'web/dist');
const indexHtml = resolve(webDist, 'index.html');

export function createApp(bot?: Bot): Hono {
  const app = new Hono();

  // 1. Telegram webhook (webhook mode only), before API and static assets.
  if (bot) mountWebhookRoute(app, bot);

  // 2. REST API. /api/health is public; item and tag routes enforce tgAuth.
  app.route('/api', apiRoutes);

  // 3. Built SPA assets.
  app.use('*', serveStatic({ root: webDist }));

  // 4. SPA fallback. API 404s stay JSON and never receive index.html.
  app.get('*', async (c) => {
    if (c.req.path === '/api' || c.req.path.startsWith('/api/')) {
      return c.json({ error: 'API route not found' }, 404);
    }

    try {
      const html = await readFile(indexHtml, 'utf8');
      return c.html(html);
    } catch {
      return c.text(
        'Blinko-Mini API is running. Build the web app with "npm run build" to serve the Mini App.',
        503,
      );
    }
  });

  return app;
}
