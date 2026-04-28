import { z } from 'zod';

const requiredString = z.string().trim().min(1, { message: 'common.envMissing' });

const baseEnvSchema = z.object({
  PROJECT_NAME: requiredString,
  STAGE_NAME: requiredString,
  LAMBDA_ALIAS_NAME: requiredString,
  CONFIG_NAMESPACE: requiredString,
  NODE_ENV: requiredString,
  ALLOWED_ORIGINS: requiredString,
  MONGODB_URI: requiredString,
  AUTH_BYPASS: z.enum(['true', 'false'], { message: 'common.envMissing' }),
  JWT_SECRET: requiredString,
});

export const envSchema = baseEnvSchema.extend({
  REFRESH_TOKEN_MAX_AGE_SEC: requiredString,
  REFRESH_RATE_LIMIT_LIMIT: requiredString,
  REFRESH_RATE_LIMIT_WINDOW_SEC: requiredString,
  SMTP_HOST: requiredString,
  SMTP_PORT: requiredString,
  SMTP_USER: requiredString,
  SMTP_PASS: requiredString,
  SMTP_FROM: requiredString,
  TWILIO_ACCOUNT_SID: requiredString,
  TWILIO_AUTH_TOKEN: requiredString,
  TWILIO_VERIFY_SERVICE_SID: requiredString,
});

export type Env = z.infer<typeof envSchema>;
