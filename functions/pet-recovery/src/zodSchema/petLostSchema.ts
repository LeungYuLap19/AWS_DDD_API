import { z } from 'zod';
import { objectIdString, sanitizeText } from '@aws-ddd-api/shared';

export const createPetLostSchema = z
  .object({
    petId: objectIdString().optional(),
    name: z
      .string({ error: 'petRecovery.errors.petLost.nameRequired' })
      .trim()
      .min(1, 'petRecovery.errors.petLost.nameRequired')
      .max(100, 'common.invalidBodyParams')
      .transform(sanitizeText),
    birthday: z.string().trim().max(64, 'common.invalidBodyParams').optional(),
    weight: z.number().finite().optional(),
    sex: z
      .string({ error: 'petRecovery.errors.petLost.sexRequired' })
      .trim()
      .min(1, 'petRecovery.errors.petLost.sexRequired')
      .max(20, 'common.invalidBodyParams'),
    sterilization: z.boolean().optional(),
    animal: z
      .string({ error: 'petRecovery.errors.petLost.animalRequired' })
      .trim()
      .min(1, 'petRecovery.errors.petLost.animalRequired')
      .max(50, 'common.invalidBodyParams'),
    breed: z.string().trim().max(100, 'common.invalidBodyParams').transform(sanitizeText).optional(),
    description: z.string().trim().max(2000, 'common.invalidBodyParams').transform(sanitizeText).optional(),
    remarks: z.string().trim().max(2000, 'common.invalidBodyParams').transform(sanitizeText).optional(),
    status: z.string().trim().max(50, 'common.invalidBodyParams').optional(),
    owner: z.string().trim().max(200, 'common.invalidBodyParams').transform(sanitizeText).optional(),
    ownerContact1: z.number().optional(),
    lostDate: z
      .string({ error: 'petRecovery.errors.petLost.lostDateRequired' })
      .trim()
      .min(1, 'petRecovery.errors.petLost.lostDateRequired')
      .max(64, 'common.invalidBodyParams'),
    lostLocation: z
      .string({ error: 'petRecovery.errors.petLost.lostLocationRequired' })
      .trim()
      .min(1, 'petRecovery.errors.petLost.lostLocationRequired')
      .max(200, 'common.invalidBodyParams')
      .transform(sanitizeText),
    lostDistrict: z
      .string({ error: 'petRecovery.errors.petLost.lostDistrictRequired' })
      .trim()
      .min(1, 'petRecovery.errors.petLost.lostDistrictRequired')
      .max(100, 'common.invalidBodyParams')
      .transform(sanitizeText),
  })
  .strict();

export type CreatePetLostInput = z.infer<typeof createPetLostSchema>;
