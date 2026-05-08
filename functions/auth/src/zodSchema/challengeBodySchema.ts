import { z } from 'zod';

const emailBodySchema = z
  .object({
    email: z
      .string({ message: 'common.missingBodyParams' })
      .trim()
      .min(1, { message: 'common.missingBodyParams' })
      .max(254, { message: 'common.invalidBodyParams' })
      .email({ message: 'common.invalidBodyParams' }),
    lang: z.string().trim().min(1, { message: 'common.invalidBodyParams' }).max(16, { message: 'common.invalidBodyParams' }).optional(),
  })
  .strict();

const phoneBodySchema = z
  .object({
    phoneNumber: z
      .string({ message: 'common.missingBodyParams' })
      .trim()
      .min(1, { message: 'common.missingBodyParams' })
      .max(20, { message: 'common.invalidBodyParams' })
      .regex(/^\+[1-9]\d{1,14}$/, { message: 'common.invalidBodyParams' }),
  })
  .strict();

export const challengeBodySchema = z.union([emailBodySchema, phoneBodySchema], {
  message: 'common.invalidBodyParams',
});

export type ChallengeBody = z.infer<typeof challengeBodySchema>;
