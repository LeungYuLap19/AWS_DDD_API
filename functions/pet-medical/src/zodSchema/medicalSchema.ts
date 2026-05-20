import { z } from 'zod';
import { sanitizeText } from '@aws-ddd-api/shared/sanitization/text';
const medicalRecordCommonFields = {
  medicalPlace: z.string().trim().max(200, 'common.invalidBodyParams').transform(sanitizeText).optional(),
  medicalDoctor: z.string().trim().max(100, 'common.invalidBodyParams').transform(sanitizeText).optional(),
  medicalResult: z.string().trim().max(2000, 'common.invalidBodyParams').transform(sanitizeText).optional(),
  medicalSolution: z.string().trim().max(2000, 'common.invalidBodyParams').transform(sanitizeText).optional(),
};

export const createMedicalRecordSchema = z
  .object({
    medicalDate: z
      .string({ error: 'petMedical.errors.medicalRecord.invalidDateFormat' })
      .max(64, 'petMedical.errors.medicalRecord.invalidDateFormat')
      .optional(),
    ...medicalRecordCommonFields,
  })
  .strict();

export const updateMedicalRecordSchema = z
  .object({
    medicalDate: z
      .string({ error: 'petMedical.errors.medicalRecord.invalidDateFormat' })
      .min(1, 'petMedical.errors.medicalRecord.invalidDateFormat')
      .max(64, 'petMedical.errors.medicalRecord.invalidDateFormat')
      .optional()
      .nullable(),
    ...medicalRecordCommonFields,
  })
  .strict();

export type CreateMedicalRecordBody = z.infer<typeof createMedicalRecordSchema>;
export type UpdateMedicalRecordBody = z.infer<typeof updateMedicalRecordSchema>;
