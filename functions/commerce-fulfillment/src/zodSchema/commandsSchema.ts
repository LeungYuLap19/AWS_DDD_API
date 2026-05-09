import { z } from 'zod';

export const ptagDetectionEmailSchema = z
  .object({
    name: z
      .string({ message: 'common.missingBodyParams' })
      .trim()
      .min(1, 'common.missingBodyParams')
      .max(200, 'common.invalidBodyParams'),
    tagId: z
      .string({ message: 'common.missingBodyParams' })
      .trim()
      .min(1, 'common.missingBodyParams')
      .max(64, 'common.invalidBodyParams'),
    dateTime: z
      .string({ message: 'common.missingBodyParams' })
      .trim()
      .min(1, 'common.missingBodyParams')
      .max(64, 'common.invalidBodyParams'),
    locationURL: z
      .string({ message: 'common.missingBodyParams' })
      .trim()
      .min(1, 'common.missingBodyParams')
      .max(2048, 'fulfillment.errors.invalidLocationURL')
      .url('fulfillment.errors.invalidLocationURL')
      .refine((url) => url.startsWith('https://'), 'fulfillment.errors.invalidLocationURL'),
    email: z
      .string({ message: 'common.missingBodyParams' })
      .trim()
      .min(1, 'common.missingBodyParams')
      .max(254, 'fulfillment.errors.invalidEmail')
      .email('fulfillment.errors.invalidEmail'),
  })
  .strict();

export type PtagDetectionEmailPayload = z.infer<typeof ptagDetectionEmailSchema>;
