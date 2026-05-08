import { z } from 'zod';

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
    email: z
      .string()
      .max(254, 'common.invalidBodyParams')
      .refine((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()), { message: 'common.invalidBodyParams' })
      .optional(),
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
    phoneNumber: z
      .string()
      .max(20, 'common.invalidBodyParams')
      .refine((value) => /^\+[1-9]\d{1,14}$/.test(value.trim()), { message: 'common.invalidBodyParams' })
      .optional(),
  })
  .strict();

export type UserPatchBody = z.infer<typeof userPatchBodySchema>;
