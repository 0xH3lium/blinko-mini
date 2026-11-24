import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

dotenv.config({ path: resolve(PROJECT_ROOT, '.env') });

const envSchema = z
  .object({
    PORT: z.coerce.number().int().positive().max(65_535).default(3000),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DB_PATH: z.string().min(1).default('./data/app.db'),
    PUBLIC_URL: z.string().default('http://localhost:3000'),
    OWNER_TIMEZONE: z.string().default('Asia/Tehran'),

    BOT_TOKEN: z.string().min(1, 'BOT_TOKEN is required'),
    OWNER_TELEGRAM_ID: z.coerce.number().int().positive(),
    BOT_MODE: z.enum(['polling', 'webhook']).default('polling'),
    WEBHOOK_URL: z.preprocess((value) => (value === '' ? undefined : value), z.string().url().optional()),
    WEBHOOK_PATH: z.string().default('/telegram/webhook'),
    WEBHOOK_SECRET: z.preprocess((value) => (value === '' ? undefined : value), z.string().optional()),

    SESSION_SECRET: z.preprocess((value) => (value === '' ? undefined : value), z.string().optional()),
    DEV_AUTH_BYPASS: z
      .string()
      .optional()
      .transform((value) => value?.toLowerCase() === 'true'),
  })
  .superRefine((env, ctx) => {
    if (!env.WEBHOOK_PATH.startsWith('/')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['WEBHOOK_PATH'], message: 'must start with "/"' });
    }
    if (env.BOT_MODE === 'webhook') {
      if (!env.WEBHOOK_URL) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['WEBHOOK_URL'], message: 'required in webhook mode' });
      }
      if (!env.WEBHOOK_SECRET) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['WEBHOOK_SECRET'], message: 'required in webhook mode' });
      }
    }
    if (env.NODE_ENV === 'production' && !env.SESSION_SECRET) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['SESSION_SECRET'], message: 'required in production' });
    }
    if (env.DEV_AUTH_BYPASS && env.NODE_ENV === 'production') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['DEV_AUTH_BYPASS'], message: 'must never be enabled in production' });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || 'env'}: ${issue.message}`)
    .join('\n');
  console.error(`[Config] Invalid environment:\n${details}\n\nCopy .env.example to .env and fill it in.`);
  process.exit(1);
}

const data = parsed.data;

export const config = {
  ...data,
  PROJECT_ROOT,
  DB_PATH: data.DB_PATH === ':memory:' ? data.DB_PATH : resolve(PROJECT_ROOT, data.DB_PATH),
  SESSION_SECRET: data.SESSION_SECRET ?? randomBytes(32).toString('hex'),
  DEV_AUTH_BYPASS: data.NODE_ENV !== 'production' && data.DEV_AUTH_BYPASS === true,
  SECURE_COOKIE: data.PUBLIC_URL.startsWith('https://'),
};

export type Config = typeof config;
