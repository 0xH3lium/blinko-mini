import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { config } from '../config.js';
import { getDatabase } from '../db/client.js';
import {
  consumeMagicToken,
  consumeShortCode,
  revokeSession,
  validateSession,
} from '../services/auth.service.js';
import { SESSION_COOKIE } from '../middleware/sessionAuth.js';

export const authRoutes = new Hono();

function setSessionCookie(c: Parameters<typeof setCookie>[0], token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure: config.SECURE_COOKIE,
    maxAge: 30 * 86_400,
  });
}

authRoutes.get('/login', (c) => {
  const token = c.req.query('token');
  if (!token) return c.text('Missing login token.', 400);
  const session = consumeMagicToken(getDatabase(), token);
  if (!session) return c.text('Login token is invalid or expired. Send /web to the bot again.', 401);
  setSessionCookie(c, session);
  return c.redirect('/');
});

authRoutes.post('/code', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const code = typeof (body as { code?: unknown })?.code === 'string' ? (body as { code: string }).code : '';
  const session = consumeShortCode(getDatabase(), code);
  if (!session) return c.json({ error: 'Invalid or expired code' }, 401);
  setSessionCookie(c, session);
  return c.json({ authenticated: true });
});

authRoutes.post('/logout', (c) => {
  revokeSession(getDatabase(), getCookie(c, SESSION_COOKIE));
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ authenticated: false });
});

authRoutes.get('/me', (c) => {
  const authenticated =
    config.DEV_AUTH_BYPASS || validateSession(getDatabase(), getCookie(c, SESSION_COOKIE));
  return c.json({ authenticated });
});
