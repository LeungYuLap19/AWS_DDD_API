import { z } from 'zod';
import { objectIdString } from '@aws-ddd-api/shared';

export const catalogEventBodySchema = z
  .object({
    petId: objectIdString(),
    userId: objectIdString(),
    userEmail: z
      .string()
      .trim()
      .min(1, 'common.missingBodyParams')
      .max(254, 'common.invalidBodyParams')
      .email('common.invalidBodyParams'),
    productUrl: z
      .string()
      .trim()
      .min(1, 'common.missingBodyParams')
      .max(2048, 'common.invalidBodyParams')
      .url('common.invalidBodyParams'),
    accessAt: z.string().trim().max(64, 'common.invalidBodyParams').optional(),
  })
  .strict();

export type CatalogEventBody = z.infer<typeof catalogEventBodySchema>;
