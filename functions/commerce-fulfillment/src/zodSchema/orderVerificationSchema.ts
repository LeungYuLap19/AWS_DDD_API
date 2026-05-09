import { z } from 'zod';
import { sanitizeText } from '@aws-ddd-api/shared';
import { parseDDMMYYYY } from '../utils/normalize';

const nullableTextField = (max: number = 500) =>
  z
    .string({ message: 'fulfillment.errors.invalidField' })
    .trim()
    .max(max, { message: 'fulfillment.errors.invalidField' })
    .transform(sanitizeText)
    .optional();

const validDateField = z
  .union([
    z
      .string({ message: 'fulfillment.errors.invalidDate' })
      .trim()
      .min(1, 'fulfillment.errors.invalidDate')
      .max(64, 'fulfillment.errors.invalidDate'),
    z.date({ message: 'fulfillment.errors.invalidDate' }),
  ])
  .refine((value) => parseDDMMYYYY(value) !== null, {
    message: 'fulfillment.errors.invalidDate',
  });

export const supplierUpdateSchema = z
  .object({
    contact: nullableTextField(50),
    petName: nullableTextField(100),
    shortUrl: nullableTextField(2048),
    masterEmail: nullableTextField(254),
    location: nullableTextField(200),
    petHuman: nullableTextField(200),
    pendingStatus: z
      .boolean({ message: 'fulfillment.errors.invalidPendingStatus' })
      .optional(),
    qrUrl: nullableTextField(2048),
    petUrl: nullableTextField(2048),
    petContact: nullableTextField(50),
  })
  .strict();

export const tagUpdateSchema = z
  .object({
    contact: nullableTextField(50),
    verifyDate: validDateField.optional(),
    petName: nullableTextField(100),
    shortUrl: nullableTextField(2048),
    masterEmail: nullableTextField(254),
    orderId: nullableTextField(64),
    location: nullableTextField(200),
    petHuman: nullableTextField(200),
  })
  .strict();

export type SupplierUpdatePayload = z.infer<typeof supplierUpdateSchema>;
export type TagUpdatePayload = z.infer<typeof tagUpdateSchema>;
