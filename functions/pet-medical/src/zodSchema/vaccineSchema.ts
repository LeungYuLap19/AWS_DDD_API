import { z } from 'zod';
import { sanitizeText } from '@aws-ddd-api/shared/sanitization/text';
const vaccineCommonFields = {
  vaccineName: z
    .string()
    .trim()
    .max(200, 'common.invalidBodyParams')
    .transform(sanitizeText)
    .optional(),
  vaccineNumber: z
    .string()
    .trim()
    .max(100, 'common.invalidBodyParams')
    .transform(sanitizeText)
    .optional(),
  vaccineTimes: z
    .string()
    .trim()
    .max(100, 'common.invalidBodyParams')
    .transform(sanitizeText)
    .optional(),
  vaccinePosition: z
    .string()
    .trim()
    .max(100, 'common.invalidBodyParams')
    .transform(sanitizeText)
    .optional(),
};

export const createVaccineRecordSchema = z
  .object({
    vaccineDate: z
      .string({ error: 'petMedical.errors.vaccineRecord.invalidDateFormat' })
      .max(64, 'petMedical.errors.vaccineRecord.invalidDateFormat')
      .optional(),
    ...vaccineCommonFields,
  })
  .strict();

export const updateVaccineRecordSchema = z
  .object({
    vaccineDate: z
      .string({ error: 'petMedical.errors.vaccineRecord.invalidDateFormat' })
      .min(1, 'petMedical.errors.vaccineRecord.invalidDateFormat')
      .max(64, 'petMedical.errors.vaccineRecord.invalidDateFormat')
      .optional()
      .nullable(),
    ...vaccineCommonFields,
  })
  .strict();

export type CreateVaccineRecordBody = z.infer<typeof createVaccineRecordSchema>;
export type UpdateVaccineRecordBody = z.infer<typeof updateVaccineRecordSchema>;
