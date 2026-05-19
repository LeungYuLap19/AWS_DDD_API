import { z } from 'zod';

const optionalNullableString = (max: number) =>
  z.string().trim().max(max, { message: 'common.invalidBodyParams' }).optional().nullable().or(z.literal(''));

export const userPatchBodySchema = z
  .object({
    firstName: z.string().trim().max(100, 'common.invalidBodyParams').optional(),
    lastName: z.string().trim().max(100, 'common.invalidBodyParams').optional(),
    birthday: z
      .string()
      .trim()
      .max(32, 'common.invalidBodyParams')
      .refine((value) => !Number.isNaN(new Date(value).getTime()), { message: 'common.invalidBodyParams' })
      .optional(),
    email: optionalNullableString(254).refine(
      (value) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
      { message: 'common.invalidBodyParams' }
    ),
    district: z.string().trim().max(100, 'common.invalidBodyParams').optional(),
    image: z
      .string()
      .max(2048, 'common.invalidBodyParams')
      .refine((value) => {
        try {
          const parsed = new URL(value);
          return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch {
          return false;
        }
      }, { message: 'common.invalidBodyParams' })
      .optional(),
    phoneNumber: optionalNullableString(20).refine(
      (value) => !value || /^\+[1-9]\d{1,14}$/.test(value),
      { message: 'common.invalidBodyParams' }
    ),
  })
  .strict();

export type UserPatchBody = z.infer<typeof userPatchBodySchema>;
