import { z } from 'zod';

export const ptagDetectionEmailSchema = z
  .object({
    name: z
      .string({ message: 'fulfillment.errors.missingFields' })
      .min(1, 'fulfillment.errors.missingFields'),
    tagId: z
      .string({ message: 'fulfillment.errors.missingFields' })
      .min(1, 'fulfillment.errors.missingFields'),
    dateTime: z
      .string({ message: 'fulfillment.errors.missingFields' })
      .min(1, 'fulfillment.errors.missingFields'),
    locationURL: z
      .string({ message: 'fulfillment.errors.missingFields' })
      .min(1, 'fulfillment.errors.missingFields')
      .url('fulfillment.errors.invalidLocationURL')
      .refine((url) => url.startsWith('https://'), 'fulfillment.errors.invalidLocationURL'),
    email: z
      .string({ message: 'fulfillment.errors.missingFields' })
      .min(1, 'fulfillment.errors.missingFields')
      .email('fulfillment.errors.invalidEmail'),
  })
  .strict();

export type PtagDetectionEmailPayload = z.infer<typeof ptagDetectionEmailSchema>;
