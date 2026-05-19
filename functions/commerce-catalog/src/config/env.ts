import { validateEnv } from '@aws-ddd-api/shared/config/env';
import { envSchema } from '../zodSchema/envSchema';

const env = validateEnv(envSchema);

export default env;
