import { z } from 'zod';

/**
 * Zod v4 schema for POST /commerce/orders (purchase confirmation).
 * All fields arrive as strings from lambda-multipart-parser.
 */
export const purchaseConfirmationSchema = z.object({
  lastName: z
    .string({ message: 'common.missingBodyParams' })
    .min(1, { message: 'common.missingBodyParams' }),
  email: z
    .string({ message: 'common.missingBodyParams' })
    .min(1, { message: 'common.missingBodyParams' })
    .email({ message: 'orders.errors.invalidEmail' }),
  address: z
    .string({ message: 'common.missingBodyParams' })
    .min(1, { message: 'common.missingBodyParams' }),
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
    .min(1, { message: 'common.missingBodyParams' })
    .max(128),
  delivery: z
    .string({ message: 'common.missingBodyParams' })
    .min(1, { message: 'common.missingBodyParams' })
    .max(128),
  petName: z
    .string({ message: 'common.missingBodyParams' })
    .min(1, { message: 'common.missingBodyParams' }),
  phoneNumber: z
    .string()
    .min(1, { message: 'common.missingBodyParams' })
    .regex(/^\d{7,15}$/, { message: 'orders.errors.invalidPhone' }),
  type: z.string().max(64).optional().default(''),
  shopCode: z
    .string({ message: 'orders.errors.invalidShopCode' })
    .min(1, { message: 'orders.errors.invalidShopCode' })
    .max(64),
  promotionCode: z.string().max(64).optional().default(''),
  petContact: z.string().optional().default(''),
  optionImg: z.string().optional().default(''),
  optionSize: z.string().max(32).optional().default(''),
  optionColor: z.string().max(64).optional().default(''),
  lang: z.enum(['chn', 'eng']).optional().default('eng'),
});

export type PurchaseConfirmationInput = z.infer<typeof purchaseConfirmationSchema>;
