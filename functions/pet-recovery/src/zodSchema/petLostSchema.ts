import { z } from 'zod';
import mongoose from 'mongoose';

const objectIdString = z
  .string()
  .refine((v) => mongoose.Types.ObjectId.isValid(v), 'petRecovery.errors.petLost.invalidPetId');

export const createPetLostSchema = z.object({
  petId: objectIdString.optional(),
  name: z
    .string({ error: 'petRecovery.errors.petLost.nameRequired' })
    .min(1, 'petRecovery.errors.petLost.nameRequired'),
  birthday: z.string().optional(),
  weight: z.number().optional(),
  sex: z
    .string({ error: 'petRecovery.errors.petLost.sexRequired' })
    .min(1, 'petRecovery.errors.petLost.sexRequired'),
  sterilization: z.boolean().optional(),
  animal: z
    .string({ error: 'petRecovery.errors.petLost.animalRequired' })
    .min(1, 'petRecovery.errors.petLost.animalRequired'),
  breed: z.string().optional(),
  description: z.string().optional(),
  remarks: z.string().optional(),
  status: z.string().optional(),
  owner: z.string().optional(),
  ownerContact1: z.number().optional(),
  lostDate: z
    .string({ error: 'petRecovery.errors.petLost.lostDateRequired' })
    .min(1, 'petRecovery.errors.petLost.lostDateRequired'),
  lostLocation: z
    .string({ error: 'petRecovery.errors.petLost.lostLocationRequired' })
    .min(1, 'petRecovery.errors.petLost.lostLocationRequired'),
  lostDistrict: z
    .string({ error: 'petRecovery.errors.petLost.lostDistrictRequired' })
    .min(1, 'petRecovery.errors.petLost.lostDistrictRequired'),
});

export type CreatePetLostInput = z.infer<typeof createPetLostSchema>;
