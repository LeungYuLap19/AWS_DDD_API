import { z } from 'zod';

const optionalBooleanish = z.union([z.boolean(), z.string()]).optional();

const optionalNullableString = z.string().trim().optional().nullable().or(z.literal(''));

export const userRegistrationBodySchema = z
  .object({
    firstName: z
      .string({ message: 'common.missingBodyParams' })
      .trim()
      .min(1, { message: 'common.missingBodyParams' }),
    lastName: z
      .string({ message: 'common.missingBodyParams' })
      .trim()
      .min(1, { message: 'common.missingBodyParams' }),
    email: optionalNullableString.refine(
      (value) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
      { message: 'common.invalidBodyParams' }
    ),
    phoneNumber: optionalNullableString.refine(
      (value) => !value || /^\+[1-9]\d{1,14}$/.test(value),
      { message: 'common.invalidBodyParams' }
    ),
    subscribe: optionalBooleanish,
    promotion: z.boolean().optional(),
    district: optionalNullableString,
    image: optionalNullableString.refine(
      (value) => {
        if (!value) return true;
        try {
          const parsed = new URL(value);
          return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch {
          return false;
        }
      },
      { message: 'common.invalidBodyParams' }
    ),
    birthday: optionalNullableString.refine(
      (value) => !value || !Number.isNaN(new Date(value).getTime()),
      { message: 'common.invalidBodyParams' }
    ),
    gender: optionalNullableString,
  })
  .strict()
  .refine(
    (data) => Boolean(data.email) || Boolean(data.phoneNumber),
    { message: 'common.missingBodyParams' }
  );

export type UserRegistrationBody = z.infer<typeof userRegistrationBodySchema>;
