import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { requireAuthContext } from '@aws-ddd-api/shared/auth/context';
import { logWarn } from '@aws-ddd-api/shared/logging/logger';
import { parseBody } from '@aws-ddd-api/shared/validation/zod';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { userPatchBodySchema } from '../zodSchema/userPatchBodySchema';
import { normalizeEmail, normalizePhone } from '../utils/normalize';
import { applyRateLimit } from '../utils/rateLimit';
import { response } from '../utils/response';
import { sanitizeUser } from '../utils/sanitize';

type UserDocument = {
  _id: { toString(): string };
  email?: string;
  phoneNumber?: string;
  deleted?: boolean;
  password?: string;
  firstName?: string;
  lastName?: string;
  birthday?: Date | null;
  district?: string | null;
  image?: string | null;
  [key: string]: unknown;
};

async function findActiveUserById(userId: string): Promise<UserDocument | null> {
  const User = mongoose.model('User');
  return (await User.findOne({ _id: userId, deleted: false }).lean()) as UserDocument | null;
}

/**
 * Returns the authenticated user's own profile after sanitization.
 */
export async function handleGetMe(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);
  await connectToMongoDB();

  const user = await findActiveUserById(authContext.userId);
  if (!user) {
    return response.errorResponse(404, 'common.notFound', ctx.event);
  }

  return response.successResponse(200, ctx.event, {
    message: 'success.retrieved',
    data: sanitizeUser(user),
  });
}

/**
 * Partially updates the authenticated user's own profile, preserving duplicate
 * email/phone conflict handling and returning the sanitized post-update view.
 */
export async function handlePatchMe(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const scope = 'user.services.user.patchMe';
  const requestStartedAt = Date.now();
  const authContext = requireAuthContext(ctx.event);

  const parseStartedAt = Date.now();
  const parsed = parseBody(ctx.body, userPatchBodySchema);
  logWarn('PATCH /user/me timing', {
    scope,
    event: ctx.event,
    extra: {
      phase: 'parseBody',
      durationMs: Date.now() - parseStartedAt,
      ok: parsed.ok,
      userId: authContext.userId,
    },
  });
  if (!parsed.ok) {
    logWarn('PATCH /user/me completed', {
      scope,
      event: ctx.event,
      extra: {
        outcome: 'invalidBody',
        totalDurationMs: Date.now() - requestStartedAt,
        errorKey: parsed.errorKey,
        userId: authContext.userId,
      },
    });
    return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
  }

  const connectStartedAt = Date.now();
  await connectToMongoDB();
  logWarn('PATCH /user/me timing', {
    scope,
    event: ctx.event,
    extra: {
      phase: 'connectToMongoDB',
      durationMs: Date.now() - connectStartedAt,
      userId: authContext.userId,
    },
  });

  const rateLimitStartedAt = Date.now();
  const rateLimitResponse = await applyRateLimit({
    action: 'user.patchMe',
    event: ctx.event,
    identifier: authContext.userId,
    policies: [
      { scope: 'ip', limit: 60, windowSeconds: 5 * 60 },
      { scope: 'identifier', limit: 30, windowSeconds: 5 * 60 },
    ],
  });
  logWarn('PATCH /user/me timing', {
    scope,
    event: ctx.event,
    extra: {
      phase: 'applyRateLimit',
      durationMs: Date.now() - rateLimitStartedAt,
      rateLimited: Boolean(rateLimitResponse),
      userId: authContext.userId,
    },
  });
  if (rateLimitResponse) {
    logWarn('PATCH /user/me completed', {
      scope,
      event: ctx.event,
      extra: {
        outcome: 'rateLimited',
        totalDurationMs: Date.now() - requestStartedAt,
        userId: authContext.userId,
      },
    });
    return rateLimitResponse;
  }

  const User = mongoose.model('User');
  const {
    firstName,
    lastName,
    birthday,
    email,
    district,
    image,
    phoneNumber,
  } = parsed.data;

  const normalizedEmail = email === undefined ? undefined : normalizeEmail(email);
  const normalizedPhoneNumber = phoneNumber === undefined ? undefined : normalizePhone(phoneNumber);
  const emailClearRequested = email !== undefined && !normalizedEmail;
  const phoneClearRequested = phoneNumber !== undefined && !normalizedPhoneNumber;

  const currentUserQueryStartedAt = Date.now();
  const currentUser = await findActiveUserById(authContext.userId);
  logWarn('PATCH /user/me timing', {
    scope,
    event: ctx.event,
    extra: {
      phase: 'findCurrentUser',
      durationMs: Date.now() - currentUserQueryStartedAt,
      userId: authContext.userId,
    },
  });
  if (!currentUser) {
    logWarn('PATCH /user/me completed', {
      scope,
      event: ctx.event,
      extra: {
        outcome: 'notFound',
        totalDurationMs: Date.now() - requestStartedAt,
        userId: authContext.userId,
      },
    });
    return response.errorResponse(404, 'common.notFound', ctx.event);
  }

  const currentEmail = normalizeEmail(currentUser.email);
  const currentPhoneNumber = normalizePhone(currentUser.phoneNumber);

  if (emailClearRequested || phoneClearRequested) {
    if (!currentEmail && !currentPhoneNumber) {
      logWarn('PATCH /user/me completed', {
        scope,
        event: ctx.event,
        extra: {
          outcome: 'noContactToRemove',
          totalDurationMs: Date.now() - requestStartedAt,
          userId: authContext.userId,
        },
      });
      return response.errorResponse(400, 'user.errors.noContactToRemove', ctx.event);
    }

    const nextEmail = email === undefined ? currentEmail : normalizedEmail;
    const nextPhoneNumber = phoneNumber === undefined ? currentPhoneNumber : normalizedPhoneNumber;
    if (!nextEmail && !nextPhoneNumber) {
      logWarn('PATCH /user/me completed', {
        scope,
        event: ctx.event,
        extra: {
          outcome: 'contactRequired',
          totalDurationMs: Date.now() - requestStartedAt,
          userId: authContext.userId,
        },
      });
      return response.errorResponse(400, 'user.errors.contactRequired', ctx.event);
    }
  }

  if (normalizedEmail || normalizedPhoneNumber) {
    const conflictQueryStartedAt = Date.now();
    const conflict = (await User.findOne({
      $or: [
        ...(normalizedEmail ? [{ email: normalizedEmail }] : []),
        ...(normalizedPhoneNumber ? [{ phoneNumber: normalizedPhoneNumber }] : []),
      ],
      _id: { $ne: authContext.userId },
      deleted: false,
    }).lean()) as UserDocument | null;
    logWarn('PATCH /user/me timing', {
      scope,
      event: ctx.event,
      extra: {
        phase: 'findConflict',
        durationMs: Date.now() - conflictQueryStartedAt,
        hadConflict: Boolean(conflict),
        userId: authContext.userId,
      },
    });

    if (conflict) {
      const errorKey =
        normalizedEmail && conflict.email === normalizedEmail
          ? 'user.errors.emailExists'
          : 'user.errors.phoneExists';

      logWarn('PATCH /user/me completed', {
        scope,
        event: ctx.event,
        extra: {
          outcome: 'conflict',
          conflictErrorKey: errorKey,
          totalDurationMs: Date.now() - requestStartedAt,
          userId: authContext.userId,
        },
      });
      return response.errorResponse(409, errorKey, ctx.event);
    }
  }

  const updateFields: Record<string, unknown> = {};
  const unsetFields: Record<string, 1> = {};
  if (firstName !== undefined) updateFields.firstName = firstName;
  if (lastName !== undefined) updateFields.lastName = lastName;
  if (district !== undefined) updateFields.district = district;
  if (image !== undefined) updateFields.image = image;
  if (email !== undefined) {
    if (normalizedEmail) updateFields.email = normalizedEmail;
    else unsetFields.email = 1;
  }
  if (phoneNumber !== undefined) {
    if (normalizedPhoneNumber) updateFields.phoneNumber = normalizedPhoneNumber;
    else unsetFields.phoneNumber = 1;
  }
  if (birthday !== undefined) updateFields.birthday = birthday ? new Date(birthday) : null;

  const updateOperation: {
    $set: Record<string, unknown>;
    $unset?: Record<string, 1>;
  } = { $set: updateFields };
  if (Object.keys(unsetFields).length > 0) {
    updateOperation.$unset = unsetFields;
  }

  let updatedUser: UserDocument | null;
  try {
    const updateStartedAt = Date.now();
    updatedUser = (await User.findOneAndUpdate(
      { _id: authContext.userId, deleted: false },
      updateOperation,
      { returnDocument: 'after', lean: true }
    )) as UserDocument | null;
    logWarn('PATCH /user/me timing', {
      scope,
      event: ctx.event,
      extra: {
        phase: 'findOneAndUpdate',
        durationMs: Date.now() - updateStartedAt,
        foundUpdatedUser: Boolean(updatedUser),
        userId: authContext.userId,
      },
    });
  } catch (error) {
    const mongoError = error as {
      code?: number;
      keyValue?: Record<string, unknown>;
      keyPattern?: Record<string, unknown>;
    };

    if (mongoError.code === 11000) {
      const duplicateField = Object.keys(mongoError.keyPattern || {})[0];
      const duplicateKeyValue = Object.values(mongoError.keyValue || {})[0];
      const errorKey =
        duplicateField === 'phoneNumber' ||
        (typeof duplicateKeyValue === 'string' && duplicateKeyValue === normalizedPhoneNumber)
          ? 'user.errors.phoneExists'
          : 'user.errors.emailExists';

      logWarn('PATCH /user/me completed', {
        scope,
        event: ctx.event,
        extra: {
          outcome: 'duplicateKey',
          duplicateField,
          duplicateErrorKey: errorKey,
          totalDurationMs: Date.now() - requestStartedAt,
          userId: authContext.userId,
        },
      });
      return response.errorResponse(409, errorKey, ctx.event);
    }

    logWarn('PATCH /user/me failed unexpectedly', {
      scope,
      event: ctx.event,
      error,
      extra: {
        outcome: 'exception',
        totalDurationMs: Date.now() - requestStartedAt,
        userId: authContext.userId,
      },
    });
    throw error;
  }

  if (!updatedUser) {
    logWarn('PATCH /user/me completed', {
      scope,
      event: ctx.event,
      extra: {
        outcome: 'notFoundAfterUpdate',
        totalDurationMs: Date.now() - requestStartedAt,
        userId: authContext.userId,
      },
    });
    return response.errorResponse(404, 'common.notFound', ctx.event);
  }

  logWarn('PATCH /user/me completed', {
    scope,
    event: ctx.event,
    extra: {
      outcome: 'success',
      totalDurationMs: Date.now() - requestStartedAt,
      hasEmailInPayload: email !== undefined,
      hasPhoneInPayload: phoneNumber !== undefined,
      userId: authContext.userId,
    },
  });
  return response.successResponse(200, ctx.event, {
    message: 'success.updated',
    data: sanitizeUser(updatedUser),
  });
}

/**
 * Soft-deletes the authenticated user's account and clears all refresh-token
 * sessions for that user in the same request.
 */
export async function handleDeleteMe(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);
  await connectToMongoDB();

  // Destructive endpoint: tighter cap to bound abuse from a compromised
  // session token before manual remediation.
  const rateLimitResponse = await applyRateLimit({
    action: 'user.deleteMe',
    event: ctx.event,
    identifier: authContext.userId,
    policies: [
      { scope: 'ip', limit: 20, windowSeconds: 60 * 60 },
      { scope: 'identifier', limit: 5, windowSeconds: 60 * 60 },
    ],
  });
  if (rateLimitResponse) return rateLimitResponse;

  const User = mongoose.model('User');
  const RefreshToken = mongoose.model('RefreshToken');
  const user = await findActiveUserById(authContext.userId);

  if (!user) {
    return response.errorResponse(404, 'common.notFound', ctx.event);
  }

  await Promise.all([
    User.updateOne({ _id: authContext.userId }, { $set: { deleted: true } }),
    RefreshToken.deleteMany({ userId: authContext.userId }),
  ]);

  return response.successResponse(200, ctx.event, {
    message: 'success.deleted',
  });
}
