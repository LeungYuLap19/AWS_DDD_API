import { z } from 'zod';

export const createMedicalRecordSchema = z
  .object({
    medicalDate: z
      .string({ error: 'petMedicalRecord.errors.medicalRecord.invalidDateFormat' })
      .optional(),
    medicalPlace: z.string().optional(),
    medicalDoctor: z.string().optional(),
    medicalResult: z.string().optional(),
    medicalSolution: z.string().optional(),
  })
  .strict();

export const updateMedicalRecordSchema = createMedicalRecordSchema;

export type CreateMedicalRecordBody = z.infer<typeof createMedicalRecordSchema>;
export type UpdateMedicalRecordBody = z.infer<typeof updateMedicalRecordSchema>;
