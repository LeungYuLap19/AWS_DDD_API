import { z } from 'zod';
import { isValidDateFormat } from '../utils/date';

export const optionalTrimmedString = () => z.string().trim().optional();
export const optionalNonEmptyString = () => z.string().trim().min(1).optional();
export const optionalDateString = (message: string) =>
  z
    .string()
    .refine((value) => isValidDateFormat(value), { message })
    .optional();

export function rejectUnknownFields(
  body: Record<string, unknown>,
  ctx: z.RefinementCtx,
  allowedFields: Set<string>,
  message: string
) {
  for (const key of Object.keys(body)) {
    if (!allowedFields.has(key)) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message,
      });
    }
  }
}
