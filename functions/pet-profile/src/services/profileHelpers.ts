import mongoose from 'mongoose';
import { requireAuthContext, HttpError } from '@aws-ddd-api/shared/auth/context';
/** Minimal user record shape used by pet-profile ownership and existence checks. */
export type UserDocument = {
  _id: { toString(): string } | string;
  deleted?: boolean;
};

export const PUBLIC_TAG_PROJECTION = {
  name: 1,
  breedimage: 1,
  animal: 1,
  birthday: 1,
  weight: 1,
  sex: 1,
  sterilization: 1,
  breed: 1,
  features: 1,
  info: 1,
  status: 1,
  receivedDate: 1,
};

/** Returns the active user document for pet-profile ownership flows. */
export async function resolveActiveUser(userId: string): Promise<UserDocument | null> {
  const User = mongoose.model('User');
  return (await User.findOne({
    _id: userId,
    deleted: { $ne: true },
  }).lean()) as UserDocument | null;
}

/**
 * Creates the default NGO-transfer stub stored on newly created pet documents
 * so later NGO reassignment flows have a predictable first element.
 */
export function buildTransferNgoSeed() {
  return [
    {
      regDate: null,
      regPlace: null,
      transferOwner: null,
      UserContact: null,
      UserEmail: null,
      transferContact: null,
      transferRemark: null,
      isTransferred: false,
    },
  ];
}

/**
 * Enforces uniqueness of `tagId` across non-deleted pets. Pass
 * `excludePetId` during patch flows to skip the current pet.
 */
export async function ensureUniqueTag(tagId: string | undefined, excludePetId?: string): Promise<void> {
  if (!tagId) {
    return;
  }

  const Pet = mongoose.model('Pet');
  const query: Record<string, unknown> = { tagId, deleted: { $ne: true } };
  if (excludePetId) {
    query._id = { $ne: excludePetId };
  }

  const existingTag = await Pet.findOne(query).select('_id').lean();
  if (existingTag) {
    throw new HttpError('petProfile.errors.duplicatePetTag', 409);
  }
}

/**
 * Enforces uniqueness of `ngoPetId` across non-deleted pets. Pass
 * `excludePetId` during patch flows to skip the current pet.
 */
export async function ensureUniqueNgoPetId(ngoPetId: string, excludePetId?: string): Promise<void> {
  if (!ngoPetId) {
    return;
  }

  const Pet = mongoose.model('Pet');
  const query: Record<string, unknown> = { ngoPetId, deleted: { $ne: true } };
  if (excludePetId) {
    query._id = { $ne: excludePetId };
  }

  const existingPet = await Pet.findOne(query).lean();
  if (existingPet) {
    throw new HttpError('petProfile.errors.duplicateNgoPetId', 409);
  }
}

/**
 * Generates the next NGO-local pet id from `NgoCounters` after proving that
 * the caller is acting for the same NGO carried in the auth context.
 */
export async function maybeGenerateNgoPetId(params: {
  authContext: ReturnType<typeof requireAuthContext>;
  ngoId?: string;
}): Promise<string> {
  if (!params.ngoId) {
    return '';
  }

  if (params.authContext.userRole !== 'ngo') {
    throw new HttpError('petProfile.errors.ngoRoleRequired', 403);
  }

  if (!params.authContext.ngoId) {
    throw new HttpError('petProfile.errors.ngoIdClaimRequired', 403);
  }

  if (String(params.authContext.ngoId) !== String(params.ngoId)) {
    throw new HttpError('common.forbidden', 403);
  }

  const NgoCounters = mongoose.model('NgoCounters');
  const counter = await NgoCounters.findOneAndUpdate(
    { ngoId: params.ngoId },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );

  const counterDoc = counter as { seq?: number; ngoPrefix?: string } | null;
  const prefix = counterDoc?.ngoPrefix || '';
  const suffix = String(counterDoc?.seq || 1).padStart(5, '0');
  return `${prefix}${suffix}`;
}
