import { z } from 'zod';

/**
 * Zod v4 schema for POST /commerce/orders (purchase confirmation).
 * All fields arrive as strings from lambda-multipart-parser.
 */
export const purchaseConfirmationSchema = z.object({
  lastName: z
    .string({ message: 'orders.errors.missingRequiredFields' })
    .min(1, { message: 'orders.errors.missingRequiredFields' }),
  email: z
    .string({ message: 'orders.errors.missingRequiredFields' })
    .min(1, { message: 'orders.errors.missingRequiredFields' })
    .email({ message: 'orders.errors.invalidEmail' }),
  address: z
    .string({ message: 'orders.errors.missingRequiredFields' })
    .min(1, { message: 'orders.errors.missingRequiredFields' }),
  option: z
    .string({ message: 'orders.errors.missingRequiredFields' })
    .min(1, { message: 'orders.errors.missingRequiredFields' })
    .max(64, { message: 'orders.errors.invalidOption' })
    .regex(/^[a-zA-Z0-9_-]+$/, { message: 'orders.errors.invalidOption' }),
  tempId: z
    .string({ message: 'orders.errors.missingRequiredFields' })
    .min(1, { message: 'orders.errors.missingRequiredFields' })
    .max(64, { message: 'orders.errors.invalidTempId' })
    .regex(/^[a-zA-Z0-9_-]+$/, { message: 'orders.errors.invalidTempId' }),
  paymentWay: z
    .string({ message: 'orders.errors.missingRequiredFields' })
    .min(1, { message: 'orders.errors.missingRequiredFields' })
    .max(128),
  delivery: z
    .string({ message: 'orders.errors.missingRequiredFields' })
    .min(1, { message: 'orders.errors.missingRequiredFields' })
    .max(128),
  petName: z
    .string({ message: 'orders.errors.missingRequiredFields' })
    .min(1, { message: 'orders.errors.missingRequiredFields' }),
  phoneNumber: z
    .string()
    .min(1, { message: 'orders.errors.missingPhoneNumber' })
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
