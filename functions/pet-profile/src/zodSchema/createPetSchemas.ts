import { z } from 'zod';
import { sanitizeText } from '@aws-ddd-api/shared/sanitization/text';
import {
  TEXT_MAX,
  optionalDateString,
  optionalNonEmptyString,
  optionalTrimmedString,
  requiredDateString,
} from './shared';

export const createPetBodySchema = z
  .object({
    name: z
      .string({ error: 'petProfile.errors.nameRequired' })
      .trim()
      .min(1, 'petProfile.errors.nameRequired')
      .max(TEXT_MAX.short, 'common.invalidBodyParams')
      .transform(sanitizeText),
    animal: z
      .string({ error: 'petProfile.errors.animalRequired' })
      .trim()
      .min(1, 'petProfile.errors.animalRequired')
      .max(50, 'common.invalidBodyParams')
      .transform(sanitizeText),
    sex: z
      .string({ error: 'petProfile.errors.sexRequired' })
      .trim()
      .min(1, 'petProfile.errors.sexRequired')
      .max(20, 'common.invalidBodyParams')
      .transform(sanitizeText),
    breed: optionalTrimmedString(TEXT_MAX.short),
    birthday: requiredDateString('petProfile.errors.birthdayRequired', 'petProfile.errors.invalidDateFormat'),
    weight: z.number().finite().optional(),
    sterilization: z.boolean().optional(),
    sterilizationDate: optionalDateString('petProfile.errors.invalidSterilizationDateFormat'),
    adoptionStatus: optionalTrimmedString(50),
    bloodType: optionalTrimmedString(20),
    features: optionalTrimmedString(TEXT_MAX.long),
    info: optionalTrimmedString(TEXT_MAX.long),
    status: optionalTrimmedString(50),
    owner: optionalTrimmedString(TEXT_MAX.medium),
    ngoId: optionalTrimmedString(64),
    ownerContact1: z.number().optional(),
    ownerContact2: z.number().optional(),
    contact1Show: z.boolean().optional(),
    contact2Show: z.boolean().optional(),
    receivedDate: optionalDateString('petProfile.errors.invalidReceivedDateFormat'),
    location: optionalTrimmedString(TEXT_MAX.medium),
    position: optionalTrimmedString(TEXT_MAX.short),
    tagId: optionalNonEmptyString(64),
    breedimage: z
      .array(z.string().url('petProfile.errors.invalidImageUrl').max(2048, 'common.invalidBodyParams'))
      .max(20, 'common.invalidBodyParams')
      .optional(),
  })
  .strict();
