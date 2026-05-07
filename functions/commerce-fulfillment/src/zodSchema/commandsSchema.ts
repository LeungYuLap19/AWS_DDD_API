import { z } from 'zod';

export const ptagDetectionEmailSchema = z
  .object({
    name: z
      .string({ message: 'common.missingBodyParams' })
      .min(1, 'common.missingBodyParams'),
    tagId: z
      .string({ message: 'common.missingBodyParams' })
      .min(1, 'common.missingBodyParams'),
    dateTime: z
      .string({ message: 'common.missingBodyParams' })
      .min(1, 'common.missingBodyParams'),
    locationURL: z
      .string({ message: 'common.missingBodyParams' })
      .min(1, 'common.missingBodyParams')
      .url('fulfillment.errors.invalidLocationURL')
      .refine((url) => url.startsWith('https://'), 'fulfillment.errors.invalidLocationURL'),
    email: z
      .string({ message: 'common.missingBodyParams' })
      .min(1, 'common.missingBodyParams')
      .email('fulfillment.errors.invalidEmail'),
  })
  .strict();

export type PtagDetectionEmailPayload = z.infer<typeof ptagDetectionEmailSchema>;
