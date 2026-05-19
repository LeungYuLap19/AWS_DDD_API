import { validateEnv } from '@aws-ddd-api/shared/config/env';
import { envSchema, type Env } from '../zodSchema/envSchema';

let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (!cachedEnv) {
    cachedEnv = validateEnv(envSchema);
  }

  return cachedEnv;
}
