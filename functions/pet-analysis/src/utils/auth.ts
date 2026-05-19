import mongoose from 'mongoose';
import { requireAuthContext, HttpError } from '@aws-ddd-api/shared/auth/context';
import type { RouteContext } from '../../../../types/lambda';

export { requireAuthContext };

interface AuthorizedPet {
  _id: unknown;
  userId?: unknown;
  ngoId?: unknown;
  deleted?: boolean;
}

/**
 * Loads a pet used by analysis routes and enforces either direct ownership or,
 * when enabled, matching NGO ownership. Throws `HttpError` for invalid ids,
 * missing pets, or forbidden access.
 */
export async function loadAuthorizedPet(
  event: RouteContext['event'],
  petId: string,
  options: { allowNgo?: boolean } = {}
): Promise<AuthorizedPet> {
  const authContext = requireAuthContext(event);
  const allowNgo = options.allowNgo !== false;

  if (!petId || !mongoose.isValidObjectId(petId)) {
    throw new HttpError('common.invalidObjectId', 400);
  }

  const Pet = mongoose.model('Pet');
  const pet = (await Pet.findOne({ _id: petId, deleted: { $ne: true } })
    .select('_id userId ngoId deleted')
    .lean()) as AuthorizedPet | null;

  if (!pet) {
    throw new HttpError('petAnalysis.errors.petNotFound', 404);
  }

  const isOwner =
    pet.userId != null &&
    authContext.userId != null &&
    String(pet.userId) === String(authContext.userId);

  const isNgoOwner =
    allowNgo &&
    pet.ngoId != null &&
    authContext.ngoId != null &&
    String(pet.ngoId) === String(authContext.ngoId);

  if (!isOwner && !isNgoOwner) {
    throw new HttpError('common.forbidden', 403);
  }

  return pet;
}
