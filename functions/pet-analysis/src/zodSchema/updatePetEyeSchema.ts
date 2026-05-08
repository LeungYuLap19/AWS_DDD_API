import { z } from 'zod';

export const updatePetEyeSchema = z
  .object({
    petId: z
      .string({ error: 'petAnalysis.errors.updatePetEye.missingRequiredFields' })
      .trim()
      .min(1, 'petAnalysis.errors.updatePetEye.missingRequiredFields')
      .max(64, 'common.invalidBodyParams'),
    date: z
      .string({ error: 'petAnalysis.errors.updatePetEye.missingRequiredFields' })
      .trim()
      .min(1, 'petAnalysis.errors.updatePetEye.missingRequiredFields')
      .max(64, 'common.invalidBodyParams'),
    leftEyeImage1PublicAccessUrl: z
      .string({ error: 'petAnalysis.errors.updatePetEye.missingRequiredFields' })
      .trim()
      .min(1, 'petAnalysis.errors.updatePetEye.missingRequiredFields')
      .max(2048, 'common.invalidBodyParams'),
    rightEyeImage1PublicAccessUrl: z
      .string({ error: 'petAnalysis.errors.updatePetEye.missingRequiredFields' })
      .trim()
      .min(1, 'petAnalysis.errors.updatePetEye.missingRequiredFields')
      .max(2048, 'common.invalidBodyParams'),
  })
  .strict();

export type UpdatePetEyeBody = z.infer<typeof updatePetEyeSchema>;
