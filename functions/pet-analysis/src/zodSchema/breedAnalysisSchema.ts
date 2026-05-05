import { z } from 'zod';

const ALLOWED_FIELD_SET = new Set(['species', 'url']);

export const breedAnalysisSchema = z
  .object({
    species: z
      .string({ error: 'petAnalysis.errors.speciesRequired' })
      .min(1, 'petAnalysis.errors.speciesRequired')
      .max(100, 'petAnalysis.errors.fieldTooLong'),
    url: z
      .string({ error: 'petAnalysis.errors.urlRequired' })
      .min(1, 'petAnalysis.errors.urlRequired')
      .url('petAnalysis.errors.invalidUrl'),
  })
  .passthrough()
  .superRefine((obj, ctx) => {
    for (const key of Object.keys(obj)) {
      if (!ALLOWED_FIELD_SET.has(key)) {
        ctx.addIssue({
          code: 'custom',
          message: 'petAnalysis.errors.unknownField',
          path: [key],
        });
      }
    }
  })
  .transform((obj) => ({
    species: obj.species,
    url: obj.url,
  }));

export type BreedAnalysisBody = z.infer<typeof breedAnalysisSchema>;
