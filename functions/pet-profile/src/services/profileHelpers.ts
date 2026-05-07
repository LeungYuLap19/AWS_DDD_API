import mongoose from 'mongoose';
import { requireAuthContext, AuthContextError } from '@aws-ddd-api/shared';

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

export async function resolveActiveUser(userId: string): Promise<UserDocument | null> {
  const User = mongoose.model('User');
  return (await User.findOne({
    _id: userId,
    deleted: { $ne: true },
  }).lean()) as UserDocument | null;
}

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

// Pass excludePetId to skip the pet being updated (patch flow).
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
    throw new AuthContextError('petProfile.errors.duplicatePetTag', 409);
  }
}

// Pass excludePetId to skip the pet being updated (patch flow).
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
    throw new AuthContextError('petProfile.errors.duplicateNgoPetId', 409);
  }
}

export async function maybeGenerateNgoPetId(params: {
  authContext: ReturnType<typeof requireAuthContext>;
  ngoId?: string;
}): Promise<string> {
  if (!params.ngoId) {
    return '';
  }

  if (params.authContext.userRole !== 'ngo') {
    throw new AuthContextError('petProfile.errors.ngoRoleRequired', 403);
  }

  if (!params.authContext.ngoId) {
    throw new AuthContextError('petProfile.errors.ngoIdClaimRequired', 403);
  }

  if (String(params.authContext.ngoId) !== String(params.ngoId)) {
    throw new AuthContextError('common.forbidden', 403);
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
