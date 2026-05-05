import mongoose from 'mongoose';
import { requireAuthContext } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { HttpError } from './httpError';

export { requireAuthContext };

interface AuthorizedPet {
  _id: unknown;
  userId?: unknown;
  ngoId?: unknown;
  deleted?: boolean;
}

export async function loadAuthorizedPet(
  event: RouteContext['event'],
  petId: string,
  options: { allowNgo?: boolean } = {}
): Promise<AuthorizedPet> {
  const authContext = requireAuthContext(event);
  const allowNgo = options.allowNgo !== false;

  if (!petId || !mongoose.isValidObjectId(petId)) {
    throw new HttpError(400, 'petAnalysis.errors.invalidPetIdFormat');
  }

  const Pet = mongoose.model('Pet');
  const pet = (await Pet.findOne({ _id: petId, deleted: { $ne: true } })
    .select('_id userId ngoId deleted')
    .lean()) as AuthorizedPet | null;

  if (!pet) {
    throw new HttpError(404, 'petAnalysis.errors.petNotFound');
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
    throw new HttpError(403, 'common.unauthorized');
  }

  return pet;
}
