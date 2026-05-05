import { z } from 'zod';

export const createPetFoundSchema = z.object({
  animal: z
    .string({ error: 'petRecovery.errors.petFound.animalRequired' })
    .min(1, 'petRecovery.errors.petFound.animalRequired'),
  breed: z.string().optional(),
  description: z.string().optional(),
  remarks: z.string().optional(),
  status: z.string().optional(),
  owner: z.string().optional(),
  ownerContact1: z.number().optional(),
  foundDate: z
    .string({ error: 'petRecovery.errors.petFound.foundDateRequired' })
    .min(1, 'petRecovery.errors.petFound.foundDateRequired'),
  foundLocation: z
    .string({ error: 'petRecovery.errors.petFound.foundLocationRequired' })
    .min(1, 'petRecovery.errors.petFound.foundLocationRequired'),
  foundDistrict: z
    .string({ error: 'petRecovery.errors.petFound.foundDistrictRequired' })
    .min(1, 'petRecovery.errors.petFound.foundDistrictRequired'),
});

export type CreatePetFoundInput = z.infer<typeof createPetFoundSchema>;
