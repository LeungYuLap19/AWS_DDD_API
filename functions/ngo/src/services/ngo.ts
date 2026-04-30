import type { APIGatewayProxyResult } from 'aws-lambda';
import {
  AuthContextError,
  logWarn,
  requireAuthContext,
} from '@aws-ddd-api/shared';
import mongoose from 'mongoose';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import {
  hasNgoAdminAccess,
  requireAuthorizedNgoAccess,
  type NgoAuthContext,
} from '../utils/access';
import { buildNgoMemberList } from '../utils/memberList';
import { escapeRegex, flattenToDot, hasKeys, pickAllowed } from '../utils/object';
import { response } from '../utils/response';
import {
  sanitizeNgo,
  sanitizeNgoCounters,
  sanitizeNgoUserAccess,
  sanitizeUser,
} from '../utils/sanitize';
import { editNgoBodySchema } from '../zodSchema/editNgoBodySchema';

type UserDocument = {
  _id: { toString(): string };
  email?: string;
  phoneNumber?: string;
  role?: string;
  password?: string;
  [key: string]: unknown;
};

function requireNgoContext(ctx: RouteContext): NgoAuthContext {
  const authContext = requireAuthContext(ctx.event);
  if (authContext.userRole !== 'ngo' || !authContext.ngoId) {
    throw new AuthContextError('common.unauthorized', 403);
  }

  return authContext;
}

export async function handleGetMe(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireNgoContext(ctx);
  await connectToMongoDB();

  const User = mongoose.model('User');
  const NgoCounters = mongoose.model('NgoCounters');

  const authorizedNgo = await requireAuthorizedNgoAccess(ctx, authContext);
  if ('errorResponse' in authorizedNgo) {
    return authorizedNgo.errorResponse;
  }

  const results = await Promise.allSettled([
    User.findOne({ _id: authContext.userId, deleted: false }).lean(),
    NgoCounters.findOne({ ngoId: authContext.ngoId }).lean(),
  ]);

  const pick = (index: number) =>
    results[index]?.status === 'fulfilled'
      ? (results[index] as PromiseFulfilledResult<unknown>).value
      : null;
  const warningKey = (index: number, section: 'userProfile' | 'ngoCounters') => {
    const result = results[index];
    if (result?.status !== 'rejected') {
      return null;
    }

    logWarn('NGO profile section unavailable during partial success response', {
      event: ctx.event,
      error: result.reason,
      scope: 'ngo.services.ngo',
      extra: {
        section,
      },
    });

    return 'ngo.warnings.temporarilyUnavailable';
  };

  return response.successResponse(200, ctx.event, {
    userProfile: sanitizeUser(pick(0) as UserDocument | null),
    ngoProfile: sanitizeNgo(authorizedNgo.ngo),
    ngoUserAccessProfile: sanitizeNgoUserAccess(authorizedNgo.ngoUserAccess),
    ngoCounters: sanitizeNgoCounters(pick(1) as Record<string, unknown> | null),
    warnings: {
      userProfile: warningKey(0, 'userProfile'),
      ngoCounters: warningKey(1, 'ngoCounters'),
    },
  });
}

export async function handleGetMembers(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireNgoContext(ctx);
  await connectToMongoDB();
  const authorizedNgo = await requireAuthorizedNgoAccess(ctx, authContext);
  if ('errorResponse' in authorizedNgo) {
    return authorizedNgo.errorResponse;
  }

  const searchRaw = (ctx.event.queryStringParameters?.search || '').trim();
  const search = escapeRegex(searchRaw);
  const page = Math.max(parseInt(ctx.event.queryStringParameters?.page || '1', 10), 1);

  const { members, totalDocs, totalPages } = await buildNgoMemberList({
    ngoId: authContext.ngoId as string,
    search,
    page,
  });

  return response.successResponse(200, ctx.event, {
    userList: members,
    totalPages,
    totalDocs,
  });
}

export async function handlePatchMe(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireNgoContext(ctx);
  const parsed = editNgoBodySchema.safeParse(ctx.body);
  if (!parsed.success) {
    return response.errorResponse(400, 'common.invalidBodyParams', ctx.event);
  }

  await connectToMongoDB();

  const session = await mongoose.startSession();
  const User = mongoose.model('User');
  const NGO = mongoose.model('NGO');
  const NgoCounters = mongoose.model('NgoCounters');
  const NgoUserAccess = mongoose.model('NgoUserAccess');

  try {
    const authorizedNgo = await requireAuthorizedNgoAccess(ctx, authContext);
    if ('errorResponse' in authorizedNgo) {
      return authorizedNgo.errorResponse;
    }

    const USER_ALLOWED = new Set(['firstName', 'lastName', 'email', 'phoneNumber', 'gender']);
    const NGO_ALLOWED = new Set([
      'name',
      'description',
      'registrationNumber',
      'email',
      'website',
      'address.street',
      'address.city',
      'address.state',
      'address.zipCode',
      'address.country',
      'petPlacementOptions',
    ]);
    const COUNTERS_ALLOWED = new Set(['ngoPrefix', 'seq']);
    const ACCESS_ALLOWED = new Set([
      'roleInNgo',
      'menuConfig.canViewPetList',
      'menuConfig.canEditPetDetails',
      'menuConfig.canManageAdoptions',
      'menuConfig.canAccessFosterLog',
      'menuConfig.canViewReports',
      'menuConfig.canManageUsers',
      'menuConfig.canManageNgoSettings',
    ]);

    const userDot = pickAllowed(flattenToDot((parsed.data.userProfile || {}) as Record<string, unknown>), USER_ALLOWED);
    const ngoDot = pickAllowed(flattenToDot((parsed.data.ngoProfile || {}) as Record<string, unknown>), NGO_ALLOWED);
    const countersDot = pickAllowed(flattenToDot((parsed.data.ngoCounters || {}) as Record<string, unknown>), COUNTERS_ALLOWED);
    const accessDot = pickAllowed(
      flattenToDot((parsed.data.ngoUserAccessProfile || {}) as Record<string, unknown>),
      ACCESS_ALLOWED
    );
    const isAdmin = hasNgoAdminAccess(authorizedNgo.ngoUserAccess);

    if (!isAdmin && (hasKeys(ngoDot) || hasKeys(countersDot) || hasKeys(accessDot))) {
      return response.errorResponse(403, 'common.unauthorized', ctx.event);
    }

    if (userDot.email) {
      const existingUserWithEmail = (await User.findOne({
        email: userDot.email,
        _id: { $ne: authContext.userId },
        deleted: false,
      }).lean()) as UserDocument | null;
      if (existingUserWithEmail) {
        return response.errorResponse(409, 'ngo.errors.emailExists', ctx.event);
      }
    }

    if (userDot.phoneNumber) {
      const existingUserWithPhone = (await User.findOne({
        phoneNumber: userDot.phoneNumber,
        _id: { $ne: authContext.userId },
        deleted: false,
      }).lean()) as UserDocument | null;
      if (existingUserWithPhone) {
        return response.errorResponse(409, 'ngo.errors.phoneExists', ctx.event);
      }
    }

    if (ngoDot.registrationNumber) {
      const existingNgo = await NGO.findOne({
        registrationNumber: ngoDot.registrationNumber,
        _id: { $ne: authContext.ngoId },
      }).lean();
      if (existingNgo) {
        return response.errorResponse(409, 'ngo.errors.registrationNumberExists', ctx.event);
      }
    }

    let hasUpdates = false;
    const responseData: Record<string, unknown> = {};

    session.startTransaction();

    if (hasKeys(userDot)) {
      hasUpdates = true;
      responseData.userProfile = sanitizeUser(
        (await User.findOneAndUpdate(
          { _id: authContext.userId, role: 'ngo', deleted: false },
          { $set: userDot },
          { session, new: true, runValidators: true, lean: true }
        )) as UserDocument | null
      );
    }

    if (hasKeys(ngoDot)) {
      hasUpdates = true;
      responseData.ngoProfile = sanitizeNgo(await NGO.findOneAndUpdate(
        { _id: authContext.ngoId },
        { $set: ngoDot },
        { session, new: true, runValidators: true, lean: true }
      ));
    }

    if (hasKeys(countersDot)) {
      hasUpdates = true;
      responseData.ngoCounters = sanitizeNgoCounters(await NgoCounters.findOneAndUpdate(
        { ngoId: authContext.ngoId },
        { $set: countersDot },
        { session, new: true, runValidators: true, lean: true }
      ));
    }

    if (hasKeys(accessDot)) {
      hasUpdates = true;
      responseData.ngoUserAccessProfile = sanitizeNgoUserAccess(await NgoUserAccess.findOneAndUpdate(
        { ngoId: authContext.ngoId, userId: authContext.userId, isActive: true },
        { $set: accessDot },
        { session, new: true, runValidators: true, lean: true }
      ));

      if (!responseData.ngoUserAccessProfile) {
        await session.abortTransaction();
        return response.errorResponse(403, 'common.unauthorized', ctx.event);
      }
    }

    if (!hasUpdates) {
      await session.abortTransaction();
      return response.successResponse(200, ctx.event, {
        message: 'common.noFieldsToUpdate',
      });
    }

    await session.commitTransaction();

    return response.successResponse(200, ctx.event, {
      message: 'success.updated',
      updated: Object.keys(responseData),
      data: responseData,
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    if ((error as { name?: string }).name === 'ValidationError') {
      return response.errorResponse(400, 'common.invalidBodyParams', ctx.event);
    }

    throw error;
  } finally {
    session.endSession();
  }
}
