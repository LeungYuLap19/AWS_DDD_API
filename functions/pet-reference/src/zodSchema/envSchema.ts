import { z } from 'zod';

const requiredString = z.string().trim().min(1, { message: 'common.envMissing' });

export const envSchema = z.object({
  MONGODB_URI: requiredString,
});

export type Env = z.infer<typeof envSchema>;
