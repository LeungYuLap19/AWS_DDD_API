import { z } from 'zod';

// Schema for POST /pet/analysis/uploads/image — file-only, no required text fields
export const uploadImageSchema = z.object({}).strict();

// Schema for POST /pet/analysis/uploads/breed-image — requires a url (folder path) text field
export const uploadBreedImageSchema = z
  .object({
    url: z
      .string({ error: 'petAnalysis.errors.invalidFolder' })
      .trim()
      .min(1, 'petAnalysis.errors.invalidFolder')
      .max(2048, 'petAnalysis.errors.invalidFolder'),
  })
  .strict();

export type UploadBreedImageBody = z.infer<typeof uploadBreedImageSchema>;

// Schema for POST /pet/analysis/eye/{identifier} — image_url is optional (file or url required, checked in handler)
export const eyePostUploadSchema = z
  .object({
    image_url: z.string().trim().max(2048, 'common.invalidBodyParams').optional(),
  })
  .strict();

export type EyePostUploadBody = z.infer<typeof eyePostUploadSchema>;
