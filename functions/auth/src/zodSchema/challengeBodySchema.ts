import { z } from 'zod';

const emailBodySchema = z
  .object({
    email: z
      .string({ message: 'common.missingBodyParams' })
      .trim()
      .min(1, { message: 'common.missingBodyParams' })
      .email({ message: 'common.invalidBodyParams' }),
    lang: z.string().trim().min(1, { message: 'common.invalidBodyParams' }).optional(),
  })
  .strict();

const phoneBodySchema = z
  .object({
    phoneNumber: z
      .string({ message: 'common.missingBodyParams' })
      .trim()
      .min(1, { message: 'common.missingBodyParams' })
      .regex(/^\+[1-9]\d{1,14}$/, { message: 'common.invalidBodyParams' }),
  })
  .strict();

export const challengeBodySchema = z.union([emailBodySchema, phoneBodySchema], {
  message: 'common.invalidBodyParams',
});

export type ChallengeBody = z.infer<typeof challengeBodySchema>;
