import { getCookie } from 'hono/cookie';
import type { Context, Next } from 'hono';
import { config } from '../config.js';
import { getDatabase } from '../db/client.js';
import { validateSession } from '../services/auth.service.js';

export const SESSION_COOKIE = 'blinko_session';

export async function sessionAuth(c: Context, next: Next): Promise<Response | void> {
  if (config.DEV_AUTH_BYPASS) {
    await next();
    return;
  }
  const token = getCookie(c, SESSION_COOKIE);
  if (!validateSession(getDatabase(), token)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
}
