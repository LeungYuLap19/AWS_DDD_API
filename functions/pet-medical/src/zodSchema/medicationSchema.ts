import { z } from 'zod';
import { sanitizeText } from '@aws-ddd-api/shared/sanitization/text';
const medicationCommonFields = {
  drugName: z.string().trim().max(200, 'common.invalidBodyParams').transform(sanitizeText).optional(),
  drugPurpose: z.string().trim().max(500, 'common.invalidBodyParams').transform(sanitizeText).optional(),
  drugMethod: z.string().trim().max(500, 'common.invalidBodyParams').transform(sanitizeText).optional(),
  drugRemark: z.string().trim().max(2000, 'common.invalidBodyParams').transform(sanitizeText).optional(),
  allergy: z.boolean().optional(),
};

export const createMedicationRecordSchema = z
  .object({
    medicationDate: z
      .string({ error: 'petMedical.errors.medicationRecord.invalidDateFormat' })
      .max(64, 'petMedical.errors.medicationRecord.invalidDateFormat')
      .optional(),
    ...medicationCommonFields,
  })
  .strict();

export const updateMedicationRecordSchema = z
  .object({
    medicationDate: z
      .string({ error: 'petMedical.errors.medicationRecord.invalidDateFormat' })
      .min(1, 'petMedical.errors.medicationRecord.invalidDateFormat')
      .max(64, 'petMedical.errors.medicationRecord.invalidDateFormat')
      .optional()
      .nullable(),
    ...medicationCommonFields,
  })
  .strict();

export type CreateMedicationRecordBody = z.infer<typeof createMedicationRecordSchema>;
export type UpdateMedicationRecordBody = z.infer<typeof updateMedicationRecordSchema>;
