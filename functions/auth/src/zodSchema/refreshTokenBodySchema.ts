import { z } from 'zod';

export const refreshTokenBodySchema = z.object({}).strict();

export type RefreshTokenBody = z.infer<typeof refreshTokenBodySchema>;
