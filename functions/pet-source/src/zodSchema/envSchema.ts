import { z } from 'zod';

const requiredString = z.string().trim().min(1, { message: 'common.envMissing' });

export const envSchema = z.object({
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

export type Env = z.infer<typeof envSchema>;
