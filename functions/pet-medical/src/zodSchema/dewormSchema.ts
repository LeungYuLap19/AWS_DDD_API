import { z } from 'zod';

export const createDewormRecordSchema = z
  .object({
    date: z
      .string({ error: 'petMedical.errors.dewormRecord.invalidDateFormat' })
      .max(64, 'petMedical.errors.dewormRecord.invalidDateFormat')
      .optional(),
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
    frequency: z.number().int().min(0).max(3650, 'common.invalidBodyParams').optional(),
    nextDewormDate: z
      .string({ error: 'petMedical.errors.dewormRecord.invalidDateFormat' })
      .max(64, 'petMedical.errors.dewormRecord.invalidDateFormat')
      .optional(),
    notification: z.boolean().optional(),
  })
  .strict();

export const updateDewormRecordSchema = createDewormRecordSchema;

export type CreateDewormRecordBody = z.infer<typeof createDewormRecordSchema>;
export type UpdateDewormRecordBody = z.infer<typeof updateDewormRecordSchema>;
