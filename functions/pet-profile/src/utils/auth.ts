import mongoose from 'mongoose';
import { HttpError, requireAuthContext } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';

type PetDocument = {
  _id: unknown;
  userId?: unknown;
  ngoId?: string | null;
  deleted?: boolean;
  breedimage?: string[];
  ngoPetId?: string | null;
  [key: string]: unknown;
};

function toStringId(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return String(value);
}

/**
 * Loads a pet by route or explicit id and enforces owner/NGO access before
 * returning it. Throws `HttpError` for invalid ids, missing pets, or forbidden
 * access so callers can rely on shared handler mapping.
 */
export async function loadAuthorizedPet(
  event: RouteContext['event'],
  options: { petId?: string; lean?: boolean; notFoundKey?: string; forbiddenKey?: string } = {}
): Promise<PetDocument> {
  const authContext = requireAuthContext(event);
  const petId = options.petId || event.pathParameters?.petId;
  const notFoundKey = options.notFoundKey || 'petProfile.errors.petNotFound';
  const forbiddenKey = options.forbiddenKey || 'common.forbidden';

  if (!petId || !mongoose.isValidObjectId(petId)) {
    throw new HttpError('common.invalidObjectId', 400);
  }

  const Pet = mongoose.model('Pet');
  const query = Pet.findOne({ _id: petId, deleted: false });
  const pet = (options.lean === false ? await query.exec() : await query.lean()) as PetDocument | null;

  if (!pet) {
    throw new HttpError(notFoundKey, 404);
  }

  const isOwner = toStringId(pet.userId) === authContext.userId;
  const isNgoOwner = Boolean(authContext.ngoId && pet.ngoId && String(pet.ngoId) === authContext.ngoId);

  if (!isOwner && !isNgoOwner) {
    throw new HttpError(forbiddenKey, 403);
  }

  return pet;
}

/**
 * Builds the ownership filter used by write operations so both direct user
 * ownership and NGO ownership stay aligned with the auth context.
 */
export function buildOwnershipFilter(event: RouteContext['event'], petId: string): Record<string, unknown> {
  const authContext = requireAuthContext(event);
  const ownershipFilters: Record<string, unknown>[] = [{ userId: authContext.userId }];

  if (authContext.ngoId) {
    ownershipFilters.push({ ngoId: authContext.ngoId });
  }

  return {
    _id: petId,
    deleted: false,
    $or: ownershipFilters,
  };
}
