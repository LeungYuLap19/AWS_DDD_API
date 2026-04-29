import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import type { RouteContext } from '../../../../types/lambda';
import { response } from './response';

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
): Promise<
  | {
      ngo: NgoDocument;
      ngoUserAccess: NgoUserAccessDocument;
    }
  | {
      errorResponse: APIGatewayProxyResult;
    }
> {
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
    return {
      errorResponse: response.errorResponse(404, 'ngo.errors.notFound', ctx.event),
    };
  }

  if (!ngo.isActive || !ngo.isVerified) {
    return {
      errorResponse: response.errorResponse(403, 'common.unauthorized', ctx.event),
    };
  }

  if (!ngoUserAccess) {
    return {
      errorResponse: response.errorResponse(403, 'common.unauthorized', ctx.event),
    };
  }

  return { ngo, ngoUserAccess };
}

export function hasNgoAdminAccess(ngoUserAccess: NgoUserAccessDocument): boolean {
  return ngoUserAccess.roleInNgo === 'admin';
}
