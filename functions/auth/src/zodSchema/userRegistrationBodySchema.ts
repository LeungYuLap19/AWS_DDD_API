import { z } from 'zod';

const optionalBooleanish = z.union([z.boolean(), z.string()]).optional();

const optionalNullableString = (max: number) =>
  z.string().trim().max(max, { message: 'common.invalidBodyParams' }).optional().nullable().or(z.literal(''));

export const userRegistrationBodySchema = z
  .object({
    firstName: z
      .string({ message: 'common.missingBodyParams' })
      .trim()
      .min(1, { message: 'common.missingBodyParams' })
      .max(100, { message: 'common.invalidBodyParams' }),
    lastName: z
      .string({ message: 'common.missingBodyParams' })
      .trim()
      .min(1, { message: 'common.missingBodyParams' })
      .max(100, { message: 'common.invalidBodyParams' }),
    email: optionalNullableString(254).refine(
      (value) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
      { message: 'common.invalidBodyParams' }
    ),
    phoneNumber: optionalNullableString(20).refine(
      (value) => !value || /^\+[1-9]\d{1,14}$/.test(value),
      { message: 'common.invalidBodyParams' }
    ),
    subscribe: optionalBooleanish,
    promotion: z.boolean().optional(),
    district: optionalNullableString(100),
    image: optionalNullableString(2048).refine(
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
    birthday: optionalNullableString(32).refine(
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
