import { z } from 'zod';

export const breedAnalysisSchema = z
  .object({
    species: z
      .string({ error: 'petAnalysis.errors.speciesRequired' })
      .trim()
      .min(1, 'petAnalysis.errors.speciesRequired')
      .max(100, 'petAnalysis.errors.fieldTooLong'),
    url: z
      .string({ error: 'petAnalysis.errors.urlRequired' })
      .trim()
      .min(1, 'petAnalysis.errors.urlRequired')
      .max(2048, 'petAnalysis.errors.invalidUrl')
      .url('petAnalysis.errors.invalidUrl'),
  })
  .strict();

export type BreedAnalysisBody = z.infer<typeof breedAnalysisSchema>;
