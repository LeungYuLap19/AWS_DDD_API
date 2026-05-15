import { z } from 'zod';

export const verifyShopCodeBodySchema = z
  .object({
    shopCode: z.string().trim().max(64, { message: 'common.invalidBodyParams' }).optional().default(''),
  })
  .strict();

export type VerifyShopCodeBody = z.infer<typeof verifyShopCodeBodySchema>;
