import { z } from 'zod';
import { sanitizeText } from '@aws-ddd-api/shared/sanitization/text';
export const createVaccineRecordSchema = z
  .object({
    vaccineDate: z
      .string({ error: 'petMedical.errors.vaccineRecord.invalidDateFormat' })
      .max(64, 'petMedical.errors.vaccineRecord.invalidDateFormat')
      .optional(),
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
  })
  .strict();

export const updateVaccineRecordSchema = createVaccineRecordSchema;

export type CreateVaccineRecordBody = z.infer<typeof createVaccineRecordSchema>;
export type UpdateVaccineRecordBody = z.infer<typeof updateVaccineRecordSchema>;
