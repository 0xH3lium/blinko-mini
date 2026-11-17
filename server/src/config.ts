import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

/** The repository root, independent of the directory npm invokes us from. */
export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

dotenv.config({ path: resolve(PROJECT_ROOT, '.env') });

const envSchema = z
  .object({
    PORT: z.coerce.number().int().positive().max(65_535).default(3000),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DB_PATH: z.string().min(1).default('./data/app.db'),
    BOT_TOKEN: z.string().min(1, 'BOT_TOKEN is required'),
    OWNER_TELEGRAM_ID: z.coerce
      .number({ invalid_type_error: 'OWNER_TELEGRAM_ID must be a numeric Telegram user id' })
      .int()
      .positive(),
    BOT_MODE: z.enum(['polling', 'webhook']).default('polling'),
    WEBHOOK_URL: z.string().url().optional(),
    WEBHOOK_PATH: z.string().default('/telegram/webhook'),
    WEBHOOK_SECRET: z.string().optional(),
    DEV_AUTH_BYPASS: z
      .string()
      .optional()
      .transform((value) => value?.toLowerCase() === 'true'),
  })
  .superRefine((env, ctx) => {
    if (!env.WEBHOOK_PATH.startsWith('/')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WEBHOOK_PATH'],
        message: 'WEBHOOK_PATH must start with "/"',
      });
    }

    if (env.BOT_MODE !== 'webhook') return;

    if (!env.WEBHOOK_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WEBHOOK_URL'],
        message: 'WEBHOOK_URL is required when BOT_MODE=webhook',
      });
    } else {
      try {
        const url = new URL(env.WEBHOOK_URL);
        if (url.protocol !== 'https:') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['WEBHOOK_URL'],
            message: 'WEBHOOK_URL must use https://',
          });
        }
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['WEBHOOK_URL'],
          message: 'WEBHOOK_URL must be a valid URL',
        });
      }
    }

    if (!env.WEBHOOK_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WEBHOOK_SECRET'],
        message: 'WEBHOOK_SECRET is required when BOT_MODE=webhook',
      });
    } else if (!/^[A-Za-z0-9_-]{1,256}$/.test(env.WEBHOOK_SECRET)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WEBHOOK_SECRET'],
        message: 'WEBHOOK_SECRET may only contain A-Z, a-z, 0-9, "_" and "-"',
      });
    }

    if (env.DEV_AUTH_BYPASS && env.NODE_ENV === 'production') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DEV_AUTH_BYPASS'],
        message: 'DEV_AUTH_BYPASS must never be enabled in production',
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || 'env'}: ${issue.message}`)
    .join('\n');
  console.error(`[Config] Invalid environment configuration:\n${details}\n\nCopy .env.example to .env and fill in the required values.`);
  process.exit(1);
}

export const config = {
  ...parsed.data,
  PROJECT_ROOT,
  DB_PATH:
    parsed.data.DB_PATH === ':memory:'
      ? parsed.data.DB_PATH
      : resolve(PROJECT_ROOT, parsed.data.DB_PATH),
  DEV_AUTH_BYPASS:
    parsed.data.NODE_ENV !== 'production' && parsed.data.DEV_AUTH_BYPASS === true,
};

export type Config = typeof config;
