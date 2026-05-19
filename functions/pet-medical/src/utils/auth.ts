import mongoose from 'mongoose';
import { requireAuthContext, HttpError } from '@aws-ddd-api/shared/auth/context';
import type { RouteContext } from '../../../../types/lambda';

export { requireAuthContext };

export interface AuthorizedPet {
  _id: unknown;
  userId?: unknown;
  ngoId?: unknown;
  deleted?: boolean;
}

/**
 * Loads a pet by id and enforces ownership: the requester must either own the
 * pet (matching `userId`) or be an NGO whose `ngoId` matches the pet's
 * `ngoId`. Throws an `HttpError` (404 / 403) on failure that the shared
 * handler maps to the right response.
 */
export async function loadAuthorizedPet(
  event: RouteContext['event'],
  petId: string
): Promise<AuthorizedPet> {
  const authContext = requireAuthContext(event);

  // Services pass `String(event.pathParameters?.petId || '')` so a missing or
  // null `pathParameters` collapses to '' here. `isValidObjectId('')` returns
  // false, producing a 400 instead of a downstream Mongoose CastError.
  if (!petId || !mongoose.isValidObjectId(petId)) {
    throw new HttpError('common.invalidObjectId', 400);
  }

  const Pet = mongoose.model('Pet');
  const pet = (await Pet.findOne({ _id: petId, deleted: { $ne: true } })
    .select('_id userId ngoId deleted')
    .lean()) as AuthorizedPet | null;

  if (!pet) {
    throw new HttpError('petMedical.errors.petNotFound', 404);
  }

  const isOwner =
    pet.userId != null &&
    authContext.userId != null &&
    String(pet.userId) === String(authContext.userId);

  const isNgoOwner =
    pet.ngoId != null &&
    authContext.ngoId != null &&
    String(pet.ngoId) === String(authContext.ngoId);

  if (!isOwner && !isNgoOwner) {
    throw new HttpError('common.forbidden', 403);
  }

  return pet;
}
