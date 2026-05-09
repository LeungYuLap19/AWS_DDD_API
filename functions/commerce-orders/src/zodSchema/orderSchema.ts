import { z } from 'zod';
import { sanitizeText } from '@aws-ddd-api/shared';

/**
 * Zod v4 schema for POST /commerce/orders (purchase confirmation).
 * All fields arrive as strings from lambda-multipart-parser.
 */
export const purchaseConfirmationSchema = z
  .object({
    lastName: z
      .string({ message: 'common.missingBodyParams' })
      .trim()
      .min(1, { message: 'common.missingBodyParams' })
      .max(100, { message: 'common.invalidBodyParams' })
      .transform(sanitizeText),
    email: z
      .string({ message: 'common.missingBodyParams' })
      .trim()
      .min(1, { message: 'common.missingBodyParams' })
      .max(254, { message: 'orders.errors.invalidEmail' })
      .email({ message: 'orders.errors.invalidEmail' }),
    address: z
      .string({ message: 'common.missingBodyParams' })
      .trim()
      .min(1, { message: 'common.missingBodyParams' })
      .max(500, { message: 'common.invalidBodyParams' })
      .transform(sanitizeText),
    option: z
      .string({ message: 'common.missingBodyParams' })
      .min(1, { message: 'common.missingBodyParams' })
      .max(64, { message: 'orders.errors.invalidOption' })
      .regex(/^[a-zA-Z0-9_-]+$/, { message: 'orders.errors.invalidOption' }),
    tempId: z
      .string({ message: 'common.missingBodyParams' })
      .min(1, { message: 'common.missingBodyParams' })
      .max(64, { message: 'orders.errors.invalidTempId' })
      .regex(/^[a-zA-Z0-9_-]+$/, { message: 'orders.errors.invalidTempId' }),
    paymentWay: z
      .string({ message: 'common.missingBodyParams' })
      .trim()
      .min(1, { message: 'common.missingBodyParams' })
      .max(128),
    delivery: z
      .string({ message: 'common.missingBodyParams' })
      .trim()
      .min(1, { message: 'common.missingBodyParams' })
      .max(128),
    petName: z
      .string({ message: 'common.missingBodyParams' })
      .trim()
      .min(1, { message: 'common.missingBodyParams' })
      .max(100, { message: 'common.invalidBodyParams' })
      .transform(sanitizeText),
    phoneNumber: z
      .string()
      .trim()
      .min(1, { message: 'common.missingBodyParams' })
      .max(20, { message: 'orders.errors.invalidPhone' })
      .regex(/^\d{7,15}$/, { message: 'orders.errors.invalidPhone' }),
    type: z.string().trim().max(64).optional().default(''),
    shopCode: z
      .string({ message: 'orders.errors.invalidShopCode' })
      .trim()
      .min(1, { message: 'orders.errors.invalidShopCode' })
      .max(64),
    promotionCode: z.string().trim().max(64).optional().default(''),
    petContact: z.string().trim().max(50, { message: 'common.invalidBodyParams' }).optional().default(''),
    optionImg: z.string().trim().max(2048, { message: 'common.invalidBodyParams' }).optional().default(''),
    optionSize: z.string().trim().max(32).optional().default(''),
    optionColor: z.string().trim().max(64).optional().default(''),
    lang: z.enum(['chn', 'eng']).optional().default('eng'),
  })
  .strict();

export type PurchaseConfirmationInput = z.infer<typeof purchaseConfirmationSchema>;
