import { z } from 'zod';

export const animalTypePathSchema = z
  .string({ error: 'petReference.errors.invalidAnimalType' })
  .trim()
  .min(1, 'petReference.errors.invalidAnimalType')
  .max(64, 'petReference.errors.invalidAnimalType');

export const breedLookupQuerySchema = z
  .object({
    lang: z
      .string({ error: 'petReference.errors.invalidLang' })
      .trim()
      .min(1, 'petReference.errors.invalidLang')
      .max(2, 'petReference.errors.invalidLang')
      .refine((value) => value === 'en' || value === 'zh', {
        message: 'petReference.errors.invalidLang',
      }),
  })
  .strict();
