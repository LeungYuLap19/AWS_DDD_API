import { z } from 'zod';

const petPlacementOptionSchema = z.object({
  name: z.string(),
  positions: z.array(z.string()),
});

const userProfileSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().email('common.invalidBodyParams').optional(),
  phoneNumber: z.string().optional(),
  gender: z.string().optional(),
});

const ngoProfileSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  registrationNumber: z.string().optional(),
  email: z.string().email('common.invalidBodyParams').optional(),
  website: z.string().optional(),
  address: z
    .object({
      street: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      zipCode: z.string().optional(),
      country: z.string().optional(),
    })
    .partial()
    .optional(),
  petPlacementOptions: z.array(petPlacementOptionSchema).optional(),
});

const ngoCountersSchema = z.object({
  ngoPrefix: z.string().optional(),
  seq: z.number().optional(),
});

const ngoUserAccessProfileSchema = z.object({
  roleInNgo: z.string().optional(),
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
    .partial()
    .optional(),
});

export const editNgoBodySchema = z.object({
  userProfile: userProfileSchema.optional(),
  ngoProfile: ngoProfileSchema.optional(),
  ngoCounters: ngoCountersSchema.optional(),
  ngoUserAccessProfile: ngoUserAccessProfileSchema.optional(),
});
