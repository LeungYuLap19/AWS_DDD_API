import { z } from 'zod';
const bloodTestCommonFields = {
  heartworm: z.string().trim().max(50, 'common.invalidBodyParams').optional(),
  lymeDisease: z.string().trim().max(50, 'common.invalidBodyParams').optional(),
  ehrlichiosis: z.string().trim().max(50, 'common.invalidBodyParams').optional(),
  anaplasmosis: z.string().trim().max(50, 'common.invalidBodyParams').optional(),
  babesiosis: z.string().trim().max(50, 'common.invalidBodyParams').optional(),
};

export const createBloodTestSchema = z
  .object({
    bloodTestDate: z
      .string({ error: 'petMedical.errors.bloodTest.invalidDateFormat' })
      .max(64, 'petMedical.errors.bloodTest.invalidDateFormat')
      .optional(),
    ...bloodTestCommonFields,
  })
  .strict();

export const updateBloodTestSchema = z
  .object({
    bloodTestDate: z
      .string({ error: 'petMedical.errors.bloodTest.invalidDateFormat' })
      .min(1, 'petMedical.errors.bloodTest.invalidDateFormat')
      .max(64, 'petMedical.errors.bloodTest.invalidDateFormat')
      .optional()
      .nullable(),
    ...bloodTestCommonFields,
  })
  .strict();

export type CreateBloodTestBody = z.infer<typeof createBloodTestSchema>;
export type UpdateBloodTestBody = z.infer<typeof updateBloodTestSchema>;
