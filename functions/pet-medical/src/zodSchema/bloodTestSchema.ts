import { z } from 'zod';

export const createBloodTestSchema = z
  .object({
    bloodTestDate: z
      .string({ error: 'petMedicalRecord.errors.bloodTest.invalidDateFormat' })
      .optional(),
    heartworm: z.string().optional(),
    lymeDisease: z.string().optional(),
    ehrlichiosis: z.string().optional(),
    anaplasmosis: z.string().optional(),
    babesiosis: z.string().optional(),
  })
  .strict();

export const updateBloodTestSchema = createBloodTestSchema;

export type CreateBloodTestBody = z.infer<typeof createBloodTestSchema>;
export type UpdateBloodTestBody = z.infer<typeof updateBloodTestSchema>;
