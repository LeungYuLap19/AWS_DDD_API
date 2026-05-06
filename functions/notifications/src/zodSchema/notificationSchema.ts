import { z } from 'zod';
import mongoose from 'mongoose';

const objectIdField = z
  .string()
  .refine((v) => mongoose.Types.ObjectId.isValid(v), { message: 'common.invalidObjectId' });

/**
 * Supported notification types derived from system domain events.
 * Based on the active endpoint inventory of PetLostandFound and related domains.
 */
export const NOTIFICATION_TYPES = [
  'nearby_pet_lost',
  'vaccine_reminder',
  'deworming_reminder',
  'medical_reminder',
  'adoption_follow_up',
  'ownership_transfer',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

function isValidDateString(v: string): boolean {
  if (v.includes('T') || /^\d{4}-\d{2}-\d{2}/.test(v)) {
    return !Number.isNaN(new Date(v).getTime());
  }
  const [day, month, year] = v.split('/');
  if (day && month && year && day.length <= 2 && month.length <= 2 && year.length === 4) {
    return !Number.isNaN(new Date(Number(year), Number(month) - 1, Number(day)).getTime());
  }
  return false;
}

export const dispatchNotificationSchema = z.object({
  targetUserId: objectIdField,
  type: z.enum(NOTIFICATION_TYPES, { message: 'notifications.errors.typeRequired' }),
  petId: objectIdField.optional().nullable(),
  petName: z.string().optional().nullable(),
  nextEventDate: z
    .string()
    .optional()
    .nullable()
    .refine((v) => v == null || isValidDateString(v), { message: 'notifications.errors.invalidDate' }),
  nearbyPetLost: z.string().optional().nullable(),
}).strict();

export type DispatchNotificationBody = z.infer<typeof dispatchNotificationSchema>;
