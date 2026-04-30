import { z } from 'zod';
import { isValidDateFormat } from '../utils/date';
import {
  optionalDateString,
  optionalNonEmptyString,
  optionalTrimmedString,
  rejectUnknownFields,
} from './shared';

const createPetAllowedFields = new Set([
  'lang',
  'name',
  'birthday',
  'weight',
  'sex',
  'sterilization',
  'animal',
  'breed',
  'features',
  'info',
  'status',
  'breedimage',
  'tagId',
  'receivedDate',
]);

const createPetMultipartAllowedFields = new Set([
  'name',
  'animal',
  'sex',
  'breed',
  'birthday',
  'weight',
  'sterilization',
  'sterilizationDate',
  'adoptionStatus',
  'bloodType',
  'features',
  'info',
  'status',
  'owner',
  'ngoId',
  'ownerContact1',
  'ownerContact2',
  'contact1Show',
  'contact2Show',
  'receivedDate',
  'location',
  'position',
  'breedimage',
]);

export const createPetBodySchema = z
  .object({
    lang: optionalTrimmedString(),
    name: z.string().trim().min(1, 'petProfile.errors.nameRequired'),
    birthday: z.string().trim().min(1, 'petProfile.errors.birthdayRequired').refine(isValidDateFormat, {
      message: 'petProfile.errors.invalidDateFormat',
    }),
    weight: z.number().finite().optional(),
    sex: z.string().trim().min(1, 'petProfile.errors.sexRequired'),
    sterilization: z.boolean().optional(),
    animal: z.string().trim().min(1, 'petProfile.errors.animalRequired'),
    breed: optionalTrimmedString(),
    features: optionalTrimmedString(),
    info: optionalTrimmedString(),
    status: optionalTrimmedString(),
    breedimage: z.array(z.string().trim().url('petProfile.errors.invalidImageUrl')).optional(),
    tagId: optionalNonEmptyString(),
    receivedDate: optionalDateString('petProfile.errors.invalidDateFormat'),
  })
  .passthrough()
  .superRefine((body, ctx) => {
    rejectUnknownFields(body, ctx, createPetAllowedFields, 'petProfile.errors.invalidBodyParams');
  });

export const createPetMultipartBodySchema = z
  .object({
    name: z.string().trim().min(1, 'petProfile.errors.nameRequired'),
    animal: z.string().trim().min(1, 'petProfile.errors.animalRequired'),
    sex: z.string().trim().min(1, 'petProfile.errors.sexRequired'),
    breed: optionalTrimmedString(),
    birthday: optionalDateString('petProfile.errors.invalidDateFormat'),
    weight: z.number().finite().optional(),
    sterilization: z.boolean().optional(),
    sterilizationDate: optionalDateString('petProfile.errors.invalidSterilizationDateFormat'),
    adoptionStatus: z.string().optional(),
    bloodType: z.string().optional(),
    features: z.string().optional(),
    info: z.string().optional(),
    status: z.string().optional(),
    owner: z.string().optional(),
    ngoId: z.string().optional(),
    ownerContact1: z.number().optional(),
    ownerContact2: z.number().optional(),
    contact1Show: z.boolean().optional(),
    contact2Show: z.boolean().optional(),
    receivedDate: optionalDateString('petProfile.errors.invalidReceivedDateFormat'),
    location: z.string().optional(),
    position: z.string().optional(),
    breedimage: z.array(z.string().url('petProfile.errors.invalidImageUrl')).optional(),
  })
  .passthrough()
  .superRefine((body, ctx) => {
    rejectUnknownFields(body, ctx, createPetMultipartAllowedFields, 'petProfile.errors.invalidBodyParams');
  });
