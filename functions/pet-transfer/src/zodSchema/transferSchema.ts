import { z } from 'zod';

export const transferCreateBodySchema = z.object({
  regDate: z.string().optional(),
  regPlace: z.string().optional(),
  transferOwner: z.string().optional(),
  transferContact: z.string().optional(),
  transferRemark: z.string().optional(),
});

export const transferUpdateBodySchema = z.object({
  regDate: z.string().optional(),
  regPlace: z.string().optional(),
  transferOwner: z.string().optional(),
  transferContact: z.string().optional(),
  transferRemark: z.string().optional(),
});

export const ngoTransferBodySchema = z
  .object({
  UserEmail: z.string().min(1).optional(),
  UserContact: z.string().min(1).optional(),
  regDate: z.string().optional(),
  regPlace: z.string().optional(),
  transferOwner: z.string().optional(),
  transferContact: z.string().optional(),
  transferRemark: z.string().optional(),
  isTransferred: z.boolean().optional(),
  })
  .refine(
    (data) => !!(data.UserEmail?.trim() || data.UserContact?.trim()),
    { message: 'petTransfer.errors.ngoTransfer.missingRequiredFields' }
  );

export type TransferCreateBody = z.infer<typeof transferCreateBodySchema>;
export type TransferUpdateBody = z.infer<typeof transferUpdateBodySchema>;
export type NgoTransferBody = z.infer<typeof ngoTransferBodySchema>;
