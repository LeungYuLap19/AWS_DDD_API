import { z } from 'zod';

export const createBloodTestSchema = z
  .object({
    bloodTestDate: z
      .string({ error: 'petMedical.errors.bloodTest.invalidDateFormat' })
      .max(64, 'petMedical.errors.bloodTest.invalidDateFormat')
      .optional(),
    heartworm: z.string().trim().max(50, 'common.invalidBodyParams').optional(),
    lymeDisease: z.string().trim().max(50, 'common.invalidBodyParams').optional(),
    ehrlichiosis: z.string().trim().max(50, 'common.invalidBodyParams').optional(),
    anaplasmosis: z.string().trim().max(50, 'common.invalidBodyParams').optional(),
    babesiosis: z.string().trim().max(50, 'common.invalidBodyParams').optional(),
  })
  .strict();

export const updateBloodTestSchema = createBloodTestSchema;

export type CreateBloodTestBody = z.infer<typeof createBloodTestSchema>;
export type UpdateBloodTestBody = z.infer<typeof updateBloodTestSchema>;
