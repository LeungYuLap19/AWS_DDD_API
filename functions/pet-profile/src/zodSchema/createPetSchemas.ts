import { z } from 'zod';
import {
  optionalDateString,
  optionalNonEmptyString,
  optionalTrimmedString,
  rejectUnknownFields,
  requiredDateString,
} from './shared';

const createPetAllowedFields = new Set([
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
  'tagId',
  'breedimage',
]);

export const createPetBodySchema = z
  .object({
    name: z.string({ error: 'petProfile.errors.nameRequired' }).trim().min(1, 'petProfile.errors.nameRequired'),
    animal: z.string({ error: 'petProfile.errors.animalRequired' }).trim().min(1, 'petProfile.errors.animalRequired'),
    sex: z.string({ error: 'petProfile.errors.sexRequired' }).trim().min(1, 'petProfile.errors.sexRequired'),
    breed: optionalTrimmedString(),
    birthday: requiredDateString('petProfile.errors.birthdayRequired', 'petProfile.errors.invalidDateFormat'),
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
    tagId: optionalNonEmptyString(),
    breedimage: z.array(z.string().url('petProfile.errors.invalidImageUrl')).optional(),
  })
  .passthrough()
  .superRefine((body, ctx) => {
    rejectUnknownFields(body, ctx, createPetAllowedFields, 'petProfile.errors.invalidBodyParams');
  });
