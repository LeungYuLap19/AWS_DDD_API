import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import type { requireAuthContext } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { HttpError } from '../utils/httpError';
import { response } from '../utils/response';

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

export function handleKnownError(error: unknown, event: RouteContext['event']): APIGatewayProxyResult | null {
  if (error instanceof HttpError) {
    return response.errorResponse(error.statusCode, error.errorKey, event);
  }

  const key = error instanceof Error ? error.message : '';
  if (key.includes('.')) {
    const statusCode = (error as { statusCode?: number }).statusCode || 400;
    return response.errorResponse(statusCode, key, event);
  }

  return null;
}

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
    throw new HttpError(409, 'petProfile.errors.duplicatePetTag');
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
    throw new HttpError(409, 'petProfile.errors.duplicateNgoPetId');
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
    throw new HttpError(403, 'petProfile.errors.ngoRoleRequired');
  }

  if (!params.authContext.ngoId) {
    throw new HttpError(403, 'petProfile.errors.ngoIdClaimRequired');
  }

  if (String(params.authContext.ngoId) !== String(params.ngoId)) {
    throw new HttpError(403, 'common.forbidden');
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
