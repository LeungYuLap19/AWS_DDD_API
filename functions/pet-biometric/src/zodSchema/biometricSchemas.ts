import { z } from 'zod';

export const registerBiometricSchema = z
  .object({
    petType: z.enum(['cat', 'dog'], { message: 'common.validationFailed' }),
  })
  .strict();

export const verifyBiometricSchema = z
  .object({
    petType: z.enum(['cat', 'dog'], { message: 'common.validationFailed' }),
    threshold: z
      .number({ message: 'common.validationFailed' })
      .gte(0, { message: 'common.validationFailed' })
      .optional(),
  })
  .strict();

export type RegisterBiometricBody = z.infer<typeof registerBiometricSchema>;
export type VerifyBiometricBody = z.infer<typeof verifyBiometricSchema>;
