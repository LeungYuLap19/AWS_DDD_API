import { z } from 'zod';
import { sanitizeText } from '@aws-ddd-api/shared';

const petPlacementOptionSchema = z
  .object({
    name: z.string().trim().max(100, 'common.invalidBodyParams').transform(sanitizeText),
    positions: z.array(z.string().trim().max(100, 'common.invalidBodyParams').transform(sanitizeText)).max(50, 'common.invalidBodyParams'),
  })
  .strict();

const userProfileSchema = z
  .object({
    firstName: z.string().trim().max(100, 'common.invalidBodyParams').transform(sanitizeText).optional(),
    lastName: z.string().trim().max(100, 'common.invalidBodyParams').transform(sanitizeText).optional(),
    email: z.string().trim().max(254, 'common.invalidBodyParams').email('common.invalidBodyParams').optional(),
    phoneNumber: z
      .string()
      .max(20, 'common.invalidBodyParams')
      .refine((value) => /^\+[1-9]\d{1,14}$/.test(value.trim()), { message: 'common.invalidBodyParams' })
      .optional(),
    gender: z.string().trim().max(20, 'common.invalidBodyParams').optional(),
  })
  .strict();

const ngoProfileSchema = z
  .object({
    name: z.string().trim().max(200, 'common.invalidBodyParams').transform(sanitizeText).optional(),
    description: z.string().trim().max(2000, 'common.invalidBodyParams').transform(sanitizeText).optional(),
    registrationNumber: z.string().trim().max(64, 'common.invalidBodyParams').optional(),
    email: z.string().trim().max(254, 'common.invalidBodyParams').email('common.invalidBodyParams').optional(),
    website: z.string().trim().max(2048, 'common.invalidBodyParams').optional(),
    address: z
      .object({
        street: z.string().trim().max(200, 'common.invalidBodyParams').optional(),
        city: z.string().trim().max(100, 'common.invalidBodyParams').optional(),
        state: z.string().trim().max(100, 'common.invalidBodyParams').optional(),
        zipCode: z.string().trim().max(20, 'common.invalidBodyParams').optional(),
        country: z.string().trim().max(100, 'common.invalidBodyParams').optional(),
      })
      .strict()
      .partial()
      .optional(),
    petPlacementOptions: z.array(petPlacementOptionSchema).max(50, 'common.invalidBodyParams').optional(),
  })
  .strict();

const ngoCountersSchema = z
  .object({
    ngoPrefix: z.string().trim().max(5, 'common.invalidBodyParams').optional(),
    seq: z.number().int().min(0, 'common.invalidBodyParams').max(1_000_000_000, 'common.invalidBodyParams').optional(),
  })
  .strict();

const ngoUserAccessProfileSchema = z
  .object({
    roleInNgo: z.string().trim().max(50, 'common.invalidBodyParams').optional(),
    menuConfig: z
      .object({
        canViewPetList: z.boolean().optional(),
        canEditPetDetails: z.boolean().optional(),
        canManageAdoptions: z.boolean().optional(),
        canAccessFosterLog: z.boolean().optional(),
        canViewReports: z.boolean().optional(),
        canManageUsers: z.boolean().optional(),
        canManageNgoSettings: z.boolean().optional(),
      })
      .strict()
      .partial()
      .optional(),
  })
  .strict();

export const editNgoBodySchema = z
  .object({
    userProfile: userProfileSchema.optional(),
    ngoProfile: ngoProfileSchema.optional(),
    ngoCounters: ngoCountersSchema.optional(),
    ngoUserAccessProfile: ngoUserAccessProfileSchema.optional(),
  })
  .strict();
