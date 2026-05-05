import { z } from 'zod';

export const createDewormRecordSchema = z
  .object({
    date: z
      .string({ error: 'petMedicalRecord.errors.dewormRecord.invalidDateFormat' })
      .optional(),
    vaccineBrand: z.string().optional(),
    vaccineType: z.string().optional(),
    typesOfInternalParasites: z.array(z.string()).optional(),
    typesOfExternalParasites: z.array(z.string()).optional(),
    frequency: z.number().optional(),
    nextDewormDate: z
      .string({ error: 'petMedicalRecord.errors.dewormRecord.invalidDateFormat' })
      .optional(),
    notification: z.boolean().optional(),
  })
  .strict();

export const updateDewormRecordSchema = createDewormRecordSchema;

export type CreateDewormRecordBody = z.infer<typeof createDewormRecordSchema>;
export type UpdateDewormRecordBody = z.infer<typeof updateDewormRecordSchema>;
