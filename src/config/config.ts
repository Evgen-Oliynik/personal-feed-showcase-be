import { validateCronExpression } from 'cron';
import { z } from 'zod';

const flag = z
  .enum(['1', 'true', '0', 'false', ''])
  .default('false')
  .transform((v) => v === '1' || v === 'true');

const optionalString = z.string().min(1).optional();

export const configSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  FRONTEND_ORIGIN: z.string().min(1).default('http://localhost:3000'),
  DATABASE_PATH: z.string().min(1).default('./data/feed.db'),
  FAKE_EXTERNALS: flag,
  FEED_CRON: z
    .string()
    .min(1)
    .default('0 6 * * *')
    .refine((v) => validateCronExpression(v).valid, {
      message: 'FEED_CRON is not a valid cron expression',
    }),
  ANTHROPIC_API_KEY: optionalString,
  EMBEDDING_MODEL: z.string().min(1).default('Xenova/all-MiniLM-L6-v2'),
  YOUTUBE_API_KEY: optionalString,
});

export type AppConfig = z.infer<typeof configSchema>;

/** Drops empty values (`KEY=` in .env) so defaults and optionals apply. */
export function validateConfig(raw: Record<string, unknown>): AppConfig {
  const cleaned = Object.fromEntries(
    Object.entries(raw).filter(([, v]) => v !== '' && v !== undefined),
  );
  return configSchema.parse(cleaned);
}
