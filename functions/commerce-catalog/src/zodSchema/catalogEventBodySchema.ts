import { z } from 'zod';

export const catalogEventBodySchema = z.object({
  petId: z.string().min(1),
  userId: z.string().min(1),
  userEmail: z.string().min(1),
  productUrl: z.string().min(1),
  accessAt: z.string().optional(),
});

export type CatalogEventBody = z.infer<typeof catalogEventBodySchema>;
