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
  SF_CUSTOMER_CODE: requiredString,
  SF_PRODUCTION_CHECK_CODE: requiredString,
  SF_SANDBOX_CHECK_CODE: requiredString,
  SF_ADDRESS_API_KEY: requiredString,
  SMTP_HOST: requiredString,
  SMTP_PORT: requiredString,
  SMTP_USER: requiredString,
  SMTP_PASS: requiredString,
  SMTP_FROM: requiredString,
});

export type Env = z.infer<typeof envSchema>;
