import { z } from 'zod';
import { sanitizeText } from '@aws-ddd-api/shared/sanitization/text';
const transferCommonFields = {
  regDate: z.string().trim().max(64, 'common.invalidBodyParams').optional(),
  regPlace: z.string().trim().max(200, 'common.invalidBodyParams').transform(sanitizeText).optional(),
  transferOwner: z.string().trim().max(200, 'common.invalidBodyParams').transform(sanitizeText).optional(),
  transferContact: z.string().trim().max(50, 'common.invalidBodyParams').optional(),
  transferRemark: z.string().trim().max(2000, 'common.invalidBodyParams').transform(sanitizeText).optional(),
};

export const transferCreateBodySchema = z.object(transferCommonFields).strict();

export const transferUpdateBodySchema = z.object(transferCommonFields).strict();

export const ngoTransferBodySchema = z
  .object({
    UserEmail: z.string().trim().min(1).max(254, 'common.invalidBodyParams').optional(),
    UserContact: z.string().trim().min(1).max(50, 'common.invalidBodyParams').optional(),
    ...transferCommonFields,
    isTransferred: z.boolean().optional(),
  })
  .strict()
  .refine(
    (data) => !!(data.UserEmail?.trim() || data.UserContact?.trim()),
    { message: 'petTransfer.errors.ngoTransfer.missingRequiredFields' }
  );

export type TransferCreateBody = z.infer<typeof transferCreateBodySchema>;
export type TransferUpdateBody = z.infer<typeof transferUpdateBodySchema>;
export type NgoTransferBody = z.infer<typeof ngoTransferBodySchema>;
