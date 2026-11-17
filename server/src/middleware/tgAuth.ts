import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Context, Next } from 'hono';
import { config } from '../config.js';

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export type InitDataResult =
  | { ok: true; user: TelegramUser }
  | { ok: false; reason: 'unauthorized' | 'forbidden' };

/**
 * Validate Telegram WebApp initData exactly as documented:
 * secret = HMAC_SHA256("WebAppData", botToken)
 * hash   = HMAC_SHA256(secret, sortedDataCheckString)
 */
export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  ownerTelegramId: number,
): InitDataResult {
  if (!initData) return { ok: false, reason: 'unauthorized' };

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, reason: 'unauthorized' };
  }

  const receivedHash = params.get('hash');
  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) {
    return { ok: false, reason: 'unauthorized' };
  }

  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculatedHash = createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  const receivedBuffer = Buffer.from(receivedHash.toLowerCase(), 'utf8');
  const calculatedBuffer = Buffer.from(calculatedHash, 'utf8');
  if (
    receivedBuffer.length !== calculatedBuffer.length ||
    !timingSafeEqual(receivedBuffer, calculatedBuffer)
  ) {
    return { ok: false, reason: 'unauthorized' };
  }

  const rawUser = params.get('user');
  if (!rawUser) return { ok: false, reason: 'unauthorized' };

  let user: TelegramUser;
  try {
    const parsed: unknown = JSON.parse(rawUser);
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      typeof (parsed as { id?: unknown }).id !== 'number'
    ) {
      return { ok: false, reason: 'unauthorized' };
    }
    user = parsed as TelegramUser;
  } catch {
    return { ok: false, reason: 'unauthorized' };
  }

  if (Number(user.id) !== ownerTelegramId) {
    return { ok: false, reason: 'forbidden' };
  }

  return { ok: true, user };
}

function readInitData(headerValue: string | undefined, authorization: string | undefined): string {
  if (headerValue?.trim()) return headerValue.trim();
  if (authorization?.toLowerCase().startsWith('tma ')) {
    return authorization.slice(4).trim();
  }
  return '';
}

/** Hono middleware that locks every guarded API route to the owner. */
export async function tgAuth(c: Context, next: Next): Promise<Response | void> {
  const initData = readInitData(
    c.req.header('X-Telegram-Init-Data'),
    c.req.header('Authorization'),
  );

  if (!initData) {
    if (config.DEV_AUTH_BYPASS) {
      await next();
      return;
    }
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const result = verifyTelegramInitData(
    initData,
    config.BOT_TOKEN,
    config.OWNER_TELEGRAM_ID,
  );

  if (!result.ok) {
    if (result.reason === 'forbidden') {
      return c.json({ error: 'Forbidden' }, 403);
    }
    return c.json({ error: 'Unauthorized' }, 401);
  }

  c.set('telegramUser', result.user);
  await next();
}
