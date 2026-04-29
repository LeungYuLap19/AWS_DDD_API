import { z } from 'zod';

export const userPatchBodySchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  birthday: z
    .string()
    .refine((value) => !Number.isNaN(new Date(value).getTime()), { message: 'common.invalidBodyParams' })
    .optional(),
  email: z
    .string()
    .refine((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()), { message: 'common.invalidEmailFormat' })
    .optional(),
  district: z.string().optional(),
  image: z
    .string()
    .refine((value) => {
      try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        return false;
      }
    }, { message: 'common.invalidBodyParams' })
    .optional(),
  phoneNumber: z
    .string()
    .refine((value) => /^\+[1-9]\d{1,14}$/.test(value.trim()), { message: 'common.invalidPhoneFormat' })
    .optional(),
});

export type UserPatchBody = z.infer<typeof userPatchBodySchema>;
