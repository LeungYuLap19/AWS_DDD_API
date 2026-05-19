import { z } from 'zod';
import { sanitizeText } from '@aws-ddd-api/shared/sanitization/text';
export const createPetFoundSchema = z
  .object({
    animal: z
      .string({ error: 'petRecovery.errors.petFound.animalRequired' })
      .trim()
      .min(1, 'petRecovery.errors.petFound.animalRequired')
      .max(50, 'common.invalidBodyParams'),
    breed: z.string().trim().max(100, 'common.invalidBodyParams').transform(sanitizeText).optional(),
    description: z.string().trim().max(2000, 'common.invalidBodyParams').transform(sanitizeText).optional(),
    remarks: z.string().trim().max(2000, 'common.invalidBodyParams').transform(sanitizeText).optional(),
    status: z.string().trim().max(50, 'common.invalidBodyParams').optional(),
    owner: z.string().trim().max(200, 'common.invalidBodyParams').transform(sanitizeText).optional(),
    ownerContact1: z.number().optional(),
    foundDate: z
      .string({ error: 'petRecovery.errors.petFound.foundDateRequired' })
      .trim()
      .min(1, 'petRecovery.errors.petFound.foundDateRequired')
      .max(64, 'common.invalidBodyParams'),
    foundLocation: z
      .string({ error: 'petRecovery.errors.petFound.foundLocationRequired' })
      .trim()
      .min(1, 'petRecovery.errors.petFound.foundLocationRequired')
      .max(200, 'common.invalidBodyParams')
      .transform(sanitizeText),
    foundDistrict: z
      .string({ error: 'petRecovery.errors.petFound.foundDistrictRequired' })
      .trim()
      .min(1, 'petRecovery.errors.petFound.foundDistrictRequired')
      .max(100, 'common.invalidBodyParams')
      .transform(sanitizeText),
  })
  .strict();

export type CreatePetFoundInput = z.infer<typeof createPetFoundSchema>;
