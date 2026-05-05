import { z } from 'zod';

export const updatePetEyeSchema = z
  .object({
    petId: z
      .string({ error: 'petAnalysis.errors.updatePetEye.missingRequiredFields' })
      .min(1, 'petAnalysis.errors.updatePetEye.missingRequiredFields'),
    date: z
      .string({ error: 'petAnalysis.errors.updatePetEye.missingRequiredFields' })
      .min(1, 'petAnalysis.errors.updatePetEye.missingRequiredFields'),
    leftEyeImage1PublicAccessUrl: z
      .string({ error: 'petAnalysis.errors.updatePetEye.missingRequiredFields' })
      .min(1, 'petAnalysis.errors.updatePetEye.missingRequiredFields'),
    rightEyeImage1PublicAccessUrl: z
      .string({ error: 'petAnalysis.errors.updatePetEye.missingRequiredFields' })
      .min(1, 'petAnalysis.errors.updatePetEye.missingRequiredFields'),
  })
  .strict();

export type UpdatePetEyeBody = z.infer<typeof updatePetEyeSchema>;
