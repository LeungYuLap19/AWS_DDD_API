import { z } from 'zod';
const dewormCommonFields = {
  vaccineBrand: z.string().trim().max(100, 'common.invalidBodyParams').optional(),
  vaccineType: z.string().trim().max(100, 'common.invalidBodyParams').optional(),
  typesOfInternalParasites: z
    .array(z.string().trim().max(100, 'common.invalidBodyParams'))
    .max(50, 'common.invalidBodyParams')
    .optional(),
  typesOfExternalParasites: z
    .array(z.string().trim().max(100, 'common.invalidBodyParams'))
    .max(50, 'common.invalidBodyParams')
    .optional(),
  notification: z.boolean().optional(),
};

export const createDewormRecordSchema = z
  .object({
    date: z
      .string({ error: 'petMedical.errors.dewormRecord.invalidDateFormat' })
      .max(64, 'petMedical.errors.dewormRecord.invalidDateFormat')
      .optional(),
    ...dewormCommonFields,
    frequency: z.number().int().min(0).max(3650, 'common.invalidBodyParams').optional(),
    nextDewormDate: z
      .string({ error: 'petMedical.errors.dewormRecord.invalidDateFormat' })
      .max(64, 'petMedical.errors.dewormRecord.invalidDateFormat')
      .optional(),
  })
  .strict();

export const updateDewormRecordSchema = z
  .object({
    date: z
      .string({ error: 'petMedical.errors.dewormRecord.invalidDateFormat' })
      .min(1, 'petMedical.errors.dewormRecord.invalidDateFormat')
      .max(64, 'petMedical.errors.dewormRecord.invalidDateFormat')
      .optional()
      .nullable(),
    ...dewormCommonFields,
    frequency: z.number().int().min(0).max(3650, 'common.invalidBodyParams').optional().nullable(),
    nextDewormDate: z
      .string({ error: 'petMedical.errors.dewormRecord.invalidDateFormat' })
      .min(1, 'petMedical.errors.dewormRecord.invalidDateFormat')
      .max(64, 'petMedical.errors.dewormRecord.invalidDateFormat')
      .optional()
      .nullable(),
  })
  .strict();

export type CreateDewormRecordBody = z.infer<typeof createDewormRecordSchema>;
export type UpdateDewormRecordBody = z.infer<typeof updateDewormRecordSchema>;
