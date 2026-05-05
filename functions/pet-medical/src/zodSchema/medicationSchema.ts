import { z } from 'zod';

export const createMedicationRecordSchema = z
  .object({
    medicationDate: z
      .string({ error: 'petMedicalRecord.errors.medicationRecord.invalidDateFormat' })
      .optional(),
    drugName: z.string().optional(),
    drugPurpose: z.string().optional(),
    drugMethod: z.string().optional(),
    drugRemark: z.string().optional(),
    allergy: z.boolean().optional(),
  })
  .strict();

export const updateMedicationRecordSchema = createMedicationRecordSchema;

export type CreateMedicationRecordBody = z.infer<typeof createMedicationRecordSchema>;
export type UpdateMedicationRecordBody = z.infer<typeof updateMedicationRecordSchema>;
