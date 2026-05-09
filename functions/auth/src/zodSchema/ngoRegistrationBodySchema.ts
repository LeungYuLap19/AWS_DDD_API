import { z } from 'zod';

const optionalBooleanish = z.union([z.boolean(), z.string()]).optional();
const optionalNullableString = (max: number) =>
  z.string().trim().max(max, { message: 'common.invalidBodyParams' }).optional().nullable().or(z.literal(''));
const ngoAddressSchema = z
  .object({
    street: z.string().trim().max(200, { message: 'common.invalidBodyParams' }).optional().default(''),
    city: z.string().trim().max(100, { message: 'common.invalidBodyParams' }).optional().default(''),
    state: z.string().trim().max(100, { message: 'common.invalidBodyParams' }).optional().default(''),
    zipCode: z.string().trim().max(20, { message: 'common.invalidBodyParams' }).optional().default(''),
    country: z.string().trim().max(100, { message: 'common.invalidBodyParams' }).optional().default(''),
  })
  .strict();

export const ngoRegistrationBodySchema = z
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
    email: z
      .string({ message: 'common.missingBodyParams' })
      .trim()
      .min(1, { message: 'common.missingBodyParams' })
      .max(254, { message: 'common.invalidBodyParams' })
      .email({ message: 'common.invalidBodyParams' }),
    phoneNumber: z
      .string({ message: 'common.missingBodyParams' })
      .trim()
      .min(1, { message: 'common.missingBodyParams' })
      .max(20, { message: 'common.invalidBodyParams' })
      .regex(/^\+[1-9]\d{1,14}$/, { message: 'common.invalidBodyParams' }),
    password: z
      .string({ message: 'common.missingBodyParams' })
      .min(8, { message: 'common.invalidBodyParams' })
      .max(128, { message: 'common.invalidBodyParams' }),
    confirmPassword: z
      .string({ message: 'common.missingBodyParams' })
      .min(1, { message: 'common.missingBodyParams' })
      .max(128, { message: 'common.invalidBodyParams' }),
    ngoName: z
      .string({ message: 'common.missingBodyParams' })
      .trim()
      .min(1, { message: 'common.missingBodyParams' })
      .max(200, { message: 'common.invalidBodyParams' }),
    ngoPrefix: z
      .string({ message: 'common.missingBodyParams' })
      .trim()
      .min(1, { message: 'common.missingBodyParams' })
      .max(5, { message: 'common.invalidBodyParams' }),
    businessRegistrationNumber: z
      .string({ message: 'common.missingBodyParams' })
      .trim()
      .min(1, { message: 'common.missingBodyParams' })
      .max(64, { message: 'common.invalidBodyParams' }),
    address: ngoAddressSchema,
    description: optionalNullableString(2000),
    website: optionalNullableString(2048),
    subscribe: optionalBooleanish,
  })
  .strict()
  .refine((data) => data.password === data.confirmPassword, {
    message: 'common.invalidBodyParams',
    path: ['confirmPassword'],
  });

export type NgoRegistrationBody = z.infer<typeof ngoRegistrationBodySchema>;
