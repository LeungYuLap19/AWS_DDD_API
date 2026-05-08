import { z } from 'zod';
import { sanitizeText } from '@aws-ddd-api/shared';

export const createMedicationRecordSchema = z
  .object({
    medicationDate: z
      .string({ error: 'petMedical.errors.medicationRecord.invalidDateFormat' })
      .max(64, 'petMedical.errors.medicationRecord.invalidDateFormat')
      .optional(),
    drugName: z.string().trim().max(200, 'common.invalidBodyParams').transform(sanitizeText).optional(),
    drugPurpose: z.string().trim().max(500, 'common.invalidBodyParams').transform(sanitizeText).optional(),
    drugMethod: z.string().trim().max(500, 'common.invalidBodyParams').transform(sanitizeText).optional(),
    drugRemark: z.string().trim().max(2000, 'common.invalidBodyParams').transform(sanitizeText).optional(),
    allergy: z.boolean().optional(),
  })
  .strict();

export const updateMedicationRecordSchema = createMedicationRecordSchema;

export type CreateMedicationRecordBody = z.infer<typeof createMedicationRecordSchema>;
export type UpdateMedicationRecordBody = z.infer<typeof updateMedicationRecordSchema>;
