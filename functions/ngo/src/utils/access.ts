import mongoose from 'mongoose';
import { HttpError } from '@aws-ddd-api/shared/auth/context';
import type { RouteContext } from '../../../../types/lambda';

/** Minimal auth context required by NGO-only service helpers. */
export type NgoAuthContext = {
  userId: string;
  userRole?: string;
  ngoId?: string;
};

/** NGO document shape consumed by access checks and sanitized profile responses. */
export type NgoDocument = {
  _id: string | { toString(): string };
  isActive?: boolean;
  isVerified?: boolean;
  [key: string]: unknown;
};

/** Active NGO membership record for one user within one NGO. */
export type NgoUserAccessDocument = {
  _id?: string | { toString(): string };
  ngoId?: string | { toString(): string };
  userId?: string | { toString(): string };
  isActive?: boolean;
  roleInNgo?: string;
  [key: string]: unknown;
};

/**
 * Loads the NGO and the caller's active NGO membership record, then enforces
 * that the NGO exists, is active/verified, and still grants the caller access.
 */
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

/** Returns whether the caller's NGO membership grants admin-level mutation rights. */
export function hasNgoAdminAccess(ngoUserAccess: NgoUserAccessDocument): boolean {
  return ngoUserAccess.roleInNgo === 'admin';
}
