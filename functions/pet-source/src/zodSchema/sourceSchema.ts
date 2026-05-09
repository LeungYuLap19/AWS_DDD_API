import { z } from 'zod';

const optionalSourceString = z.string().trim().max(200, 'common.invalidBodyParams').optional();
const optionalSourceList = z
  .array(z.string().trim().max(200, 'common.invalidBodyParams'))
  .max(50, 'common.invalidBodyParams')
  .optional();

export const sourceCreateBodySchema = z
  .object({
    placeofOrigin: optionalSourceString,
    channel: optionalSourceString,
    rescueCategory: optionalSourceList,
    causeOfInjury: optionalSourceString,
  })
  .strict()
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
  .strict();

export type SourceCreateBody = z.infer<typeof sourceCreateBodySchema>;
export type SourcePatchBody = z.infer<typeof sourcePatchBodySchema>;
