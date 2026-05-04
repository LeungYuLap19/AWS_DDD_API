import { z } from 'zod';

const optionalSourceString = z.string().optional();
const optionalSourceList = z.array(z.string()).optional();
const sourceAllowedFields = new Set([
  'placeofOrigin',
  'channel',
  'rescueCategory',
  'causeOfInjury',
]);

function rejectUnknownFields(body: Record<string, unknown>, ctx: z.RefinementCtx) {
  for (const key of Object.keys(body)) {
    if (!sourceAllowedFields.has(key)) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: 'common.invalidBodyParams',
      });
    }
  }
}

export const sourceCreateBodySchema = z
  .object({
    placeofOrigin: optionalSourceString,
    channel: optionalSourceString,
    rescueCategory: optionalSourceList,
    causeOfInjury: optionalSourceString,
  })
  .passthrough()
  .superRefine((body, ctx) => {
    rejectUnknownFields(body, ctx);
  })
  .refine((data) => Boolean(data.placeofOrigin || data.channel), {
    message: 'petSource.errors.missingRequiredFields',
  });

export const sourcePatchBodySchema = z
  .object({
    placeofOrigin: optionalSourceString,
    channel: optionalSourceString,
    rescueCategory: optionalSourceList,
    causeOfInjury: optionalSourceString,
  })
  .passthrough()
  .superRefine((body, ctx) => {
    rejectUnknownFields(body, ctx);
  });

export type SourceCreateBody = z.infer<typeof sourceCreateBodySchema>;
export type SourcePatchBody = z.infer<typeof sourcePatchBodySchema>;
