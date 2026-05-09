import { z } from 'zod';

const emailVerifyBodySchema = z
  .object({
    email: z
      .string({ message: 'common.missingBodyParams' })
      .trim()
      .min(1, { message: 'common.missingBodyParams' })
      .max(254, { message: 'common.invalidBodyParams' })
      .email({ message: 'common.invalidBodyParams' }),
    code: z
      .string({ message: 'common.missingBodyParams' })
      .trim()
      .min(1, { message: 'common.missingBodyParams' })
      .regex(/^\d{6}$/, { message: 'common.invalidBodyParams' }),
    lang: z.string().trim().min(1, { message: 'common.invalidBodyParams' }).max(16, { message: 'common.invalidBodyParams' }).optional(),
  })
  .strict();

const phoneVerifyBodySchema = z
  .object({
    phoneNumber: z
      .string({ message: 'common.missingBodyParams' })
      .trim()
      .min(1, { message: 'common.missingBodyParams' })
      .max(20, { message: 'common.invalidBodyParams' })
      .regex(/^\+[1-9]\d{1,14}$/, { message: 'common.invalidBodyParams' }),
    code: z
      .string({ message: 'common.missingBodyParams' })
      .trim()
      .min(1, { message: 'common.missingBodyParams' })
      .max(32, { message: 'common.invalidBodyParams' }),
  })
  .strict();

export const verifyChallengeBodySchema = z.union([emailVerifyBodySchema, phoneVerifyBodySchema], {
  message: 'common.invalidBodyParams',
});

export type VerifyChallengeBody = z.infer<typeof verifyChallengeBodySchema>;
