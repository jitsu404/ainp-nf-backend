import 'dotenv/config';
import { z } from 'zod';

const UNIT_SECONDS = { s: 1, m: 60, h: 3600, d: 86400 } as const;

/** "8h" → 28800. Used for both the JWT lifetime and the auth cookie's maxAge. */
const duration = z
  .string()
  .regex(/^\d+[smhd]$/, 'Use a number followed by s, m, h or d, e.g. 8h')
  .transform((value) => {
    const amount = Number(value.slice(0, -1));
    const unit = value.slice(-1) as keyof typeof UNIT_SECONDS;
    return amount * UNIT_SECONDS[unit];
  });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: duration.default(28800),
  CLIENT_ORIGIN: z.url(),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug']).optional(),
  // Only used by `npm run seed` to create the first Super Administrator.
  SEED_SUPERADMIN_EMAIL: z.email().optional(),
  SEED_SUPERADMIN_PASSWORD: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast: the app must never start with missing or invalid configuration.
  throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
}

export const env: Readonly<Env> = Object.freeze(parsed.data);

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';
