import { z } from 'zod';
import { TEXT_MAX, optionalDateString, optionalTrimmedString } from './shared';

export const patchPetBodySchema = z
  .object({
    removedIndices: z.string().trim().max(1000, 'common.invalidBodyParams').optional(),
    name: optionalTrimmedString(TEXT_MAX.short),
    animal: optionalTrimmedString(50),
    birthday: optionalDateString('petProfile.errors.invalidBirthdayFormat'),
    weight: z
      .number({ error: 'petProfile.errors.invalidWeightType' })
      .finite({ message: 'petProfile.errors.invalidWeightType' })
      .optional(),
    sex: optionalTrimmedString(20),
    sterilization: z.boolean().optional(),
    sterilizationDate: optionalDateString('petProfile.errors.invalidSterilizationDateFormat'),
    adoptionStatus: optionalTrimmedString(50),
    breed: optionalTrimmedString(TEXT_MAX.short),
    bloodType: optionalTrimmedString(20),
    features: optionalTrimmedString(TEXT_MAX.long),
    info: optionalTrimmedString(TEXT_MAX.long),
    status: optionalTrimmedString(50),
    owner: optionalTrimmedString(TEXT_MAX.medium),
    tagId: optionalTrimmedString(64),
    ownerContact1: z.number().optional(),
    ownerContact2: z.number().optional(),
    contact1Show: z.boolean().optional(),
    contact2Show: z.boolean().optional(),
    receivedDate: optionalDateString('petProfile.errors.invalidReceivedDateFormat'),
    ngoId: optionalTrimmedString(64),
    ngoPetId: optionalTrimmedString(64),
    location: optionalTrimmedString(TEXT_MAX.medium),
    position: optionalTrimmedString(TEXT_MAX.short),
    chipId: optionalTrimmedString(50),
    placeOfBirth: optionalTrimmedString(TEXT_MAX.medium),
    motherName: optionalTrimmedString(TEXT_MAX.short),
    motherBreed: optionalTrimmedString(TEXT_MAX.short),
    motherDOB: optionalDateString('petProfile.errors.invalidParentDateFormat'),
    motherChip: optionalTrimmedString(50),
    motherPlaceOfBirth: optionalTrimmedString(TEXT_MAX.medium),
    motherParity: z.coerce.number({ error: 'petProfile.errors.invalidMotherParity' }).optional(),
    fatherName: optionalTrimmedString(TEXT_MAX.short),
    fatherBreed: optionalTrimmedString(TEXT_MAX.short),
    fatherDOB: optionalDateString('petProfile.errors.invalidParentDateFormat'),
    fatherChip: optionalTrimmedString(50),
    fatherPlaceOfBirth: optionalTrimmedString(TEXT_MAX.medium),
  })
  .strict();
