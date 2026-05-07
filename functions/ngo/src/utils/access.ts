import mongoose from 'mongoose';
import { HttpError } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';

export type NgoAuthContext = {
  userId: string;
  userRole?: string;
  ngoId?: string;
};

export type NgoDocument = {
  _id: string | { toString(): string };
  isActive?: boolean;
  isVerified?: boolean;
  [key: string]: unknown;
};

export type NgoUserAccessDocument = {
  _id?: string | { toString(): string };
  ngoId?: string | { toString(): string };
  userId?: string | { toString(): string };
  isActive?: boolean;
  roleInNgo?: string;
  [key: string]: unknown;
};

export async function requireAuthorizedNgoAccess(
  ctx: RouteContext,
  authContext: NgoAuthContext
): Promise<{
  ngo: NgoDocument;
  ngoUserAccess: NgoUserAccessDocument;
}> {
  const NGO = mongoose.model('NGO');
  const NgoUserAccess = mongoose.model('NgoUserAccess');

  const [ngo, ngoUserAccess] = await Promise.all([
    NGO.findOne({ _id: authContext.ngoId }).lean() as Promise<NgoDocument | null>,
    NgoUserAccess.findOne({
      ngoId: authContext.ngoId,
      userId: authContext.userId,
      isActive: true,
    }).lean() as Promise<NgoUserAccessDocument | null>,
  ]);

  if (!ngo) {
    throw new HttpError('ngo.errors.notFound', 404);
  }

  if (!ngo.isActive || !ngo.isVerified) {
    throw new HttpError('common.forbidden', 403);
  }

  if (!ngoUserAccess) {
    throw new HttpError('common.forbidden', 403);
  }

  return { ngo, ngoUserAccess };
}

export function hasNgoAdminAccess(ngoUserAccess: NgoUserAccessDocument): boolean {
  return ngoUserAccess.roleInNgo === 'admin';
}
