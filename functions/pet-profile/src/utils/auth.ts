import mongoose from 'mongoose';
import { AuthContextError, requireAuthContext } from '@aws-ddd-api/shared';
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

export async function loadAuthorizedPet(
  event: RouteContext['event'],
  options: { petId?: string; lean?: boolean; notFoundKey?: string; forbiddenKey?: string } = {}
): Promise<PetDocument> {
  const authContext = requireAuthContext(event);
  const petId = options.petId || event.pathParameters?.petId;
  const notFoundKey = options.notFoundKey || 'petProfile.errors.petNotFound';
  const forbiddenKey = options.forbiddenKey || 'common.forbidden';

  if (!petId || !mongoose.isValidObjectId(petId)) {
    throw new AuthContextError('petProfile.errors.invalidPetId', 400);
  }

  const Pet = mongoose.model('Pet');
  const query = Pet.findOne({ _id: petId, deleted: false });
  const pet = (options.lean === false ? await query.exec() : await query.lean()) as PetDocument | null;

  if (!pet) {
    throw new AuthContextError(notFoundKey, 404);
  }

  const isOwner = toStringId(pet.userId) === authContext.userId;
  const isNgoOwner = Boolean(authContext.ngoId && pet.ngoId && String(pet.ngoId) === authContext.ngoId);

  if (!isOwner && !isNgoOwner) {
    throw new AuthContextError(forbiddenKey, 403);
  }

  return pet;
}

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
