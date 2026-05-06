import { z } from 'zod';
import { parseDDMMYYYY } from '../utils/normalize';

const nullableTextField = z
  .string({ message: 'fulfillment.errors.invalidField' })
  .trim()
  .optional();

const validDateField = z
  .union([
    z.string({ message: 'fulfillment.errors.invalidDate' }).trim().min(1, 'fulfillment.errors.invalidDate'),
    z.date({ message: 'fulfillment.errors.invalidDate' }),
  ])
  .refine((value) => parseDDMMYYYY(value) !== null, {
    message: 'fulfillment.errors.invalidDate',
  });

export const supplierUpdateSchema = z
  .object({
    contact: nullableTextField,
    petName: nullableTextField,
    shortUrl: nullableTextField,
    masterEmail: nullableTextField,
    location: nullableTextField,
    petHuman: nullableTextField,
    pendingStatus: z
      .boolean({ message: 'fulfillment.errors.invalidPendingStatus' })
      .optional(),
    qrUrl: nullableTextField,
    petUrl: nullableTextField,
    petContact: nullableTextField,
  })
  .strict();

export const tagUpdateSchema = z
  .object({
    contact: nullableTextField,
    verifyDate: validDateField.optional(),
    petName: nullableTextField,
    shortUrl: nullableTextField,
    masterEmail: nullableTextField,
    orderId: nullableTextField,
    location: nullableTextField,
    petHuman: nullableTextField,
  })
  .strict();

export type SupplierUpdatePayload = z.infer<typeof supplierUpdateSchema>;
export type TagUpdatePayload = z.infer<typeof tagUpdateSchema>;
