import { z } from 'zod';

const optionalBooleanish = z.union([z.boolean(), z.string()]).optional();
const optionalNullableString = z.string().trim().optional().nullable().or(z.literal(''));
const ngoAddressSchema = z.object({
  street: z.string().optional().default(''),
  city: z.string().optional().default(''),
  state: z.string().optional().default(''),
  zipCode: z.string().optional().default(''),
  country: z.string().optional().default(''),
});

export const ngoRegistrationBodySchema = z
  .object({
    firstName: z
      .string({ message: 'common.missingBodyParams' })
      .trim()
      .min(1, { message: 'common.missingBodyParams' }),
    lastName: z
      .string({ message: 'common.missingBodyParams' })
      .trim()
      .min(1, { message: 'common.missingBodyParams' }),
    email: z
      .string({ message: 'common.missingBodyParams' })
      .trim()
      .min(1, { message: 'common.missingBodyParams' })
      .email({ message: 'common.invalidBodyParams' }),
    phoneNumber: z
      .string({ message: 'common.missingBodyParams' })
      .trim()
      .min(1, { message: 'common.missingBodyParams' })
      .regex(/^\+[1-9]\d{1,14}$/, { message: 'common.invalidBodyParams' }),
    password: z
      .string({ message: 'common.missingBodyParams' })
      .min(8, { message: 'common.invalidBodyParams' }),
    confirmPassword: z
      .string({ message: 'common.missingBodyParams' })
      .min(1, { message: 'common.missingBodyParams' }),
    ngoName: z
      .string({ message: 'common.missingBodyParams' })
      .trim()
      .min(1, { message: 'common.missingBodyParams' }),
    ngoPrefix: z
      .string({ message: 'common.missingBodyParams' })
      .trim()
      .min(1, { message: 'common.missingBodyParams' })
      .max(5, { message: 'common.invalidBodyParams' }),
    businessRegistrationNumber: z
      .string({ message: 'common.missingBodyParams' })
      .trim()
      .min(1, { message: 'common.missingBodyParams' }),
    address: ngoAddressSchema,
    description: optionalNullableString,
    website: optionalNullableString,
    subscribe: optionalBooleanish,
  })
  .strict()
  .refine((data) => data.password === data.confirmPassword, {
    message: 'common.invalidBodyParams',
    path: ['confirmPassword'],
  });

export type NgoRegistrationBody = z.infer<typeof ngoRegistrationBodySchema>;
