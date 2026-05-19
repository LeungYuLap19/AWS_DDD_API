import { z } from 'zod';
import { sanitizeText } from '@aws-ddd-api/shared/sanitization/text';
import { isValidDateFormat } from '../utils/date';

/** Default max lengths used across pet-profile schemas. */
export const TEXT_MAX = {
  /** Short identifiers and names (e.g. pet name, owner name). */
  short: 100,
  /** Medium-length text (e.g. location, breed, chipId, tagId). */
  medium: 200,
  /** Long free-text fields (description, features, info). */
  long: 2000,
} as const;

export const optionalTrimmedString = (max: number = TEXT_MAX.medium) =>
  z
    .string()
    .trim()
    .max(max, { message: 'common.invalidBodyParams' })
    .transform(sanitizeText)
    .optional();
export const optionalNonEmptyString = (max: number = TEXT_MAX.medium) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max, { message: 'common.invalidBodyParams' })
    .transform(sanitizeText)
    .optional();
export const optionalDateString = (message: string) =>
  z
    .string()
    .max(64, { message })
    .refine((value) => isValidDateFormat(value), { message })
    .optional();

export const requiredDateString = (requiredMessage: string, formatMessage: string) =>
  z
    .string({ error: requiredMessage })
    .min(1, requiredMessage)
    .max(64, formatMessage)
    .refine((value) => isValidDateFormat(value), { message: formatMessage });

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
