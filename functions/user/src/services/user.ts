import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { requireAuthContext } from '@aws-ddd-api/shared/auth/context';
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
  const authContext = requireAuthContext(ctx.event);
  const parsed = parseBody(ctx.body, userPatchBodySchema);
  if (!parsed.ok) {
    return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
  }

  await connectToMongoDB();

  const rateLimitResponse = await applyRateLimit({
    action: 'user.patchMe',
    event: ctx.event,
    identifier: authContext.userId,
    policies: [
      { scope: 'ip', limit: 60, windowSeconds: 5 * 60 },
      { scope: 'identifier', limit: 30, windowSeconds: 5 * 60 },
    ],
  });
  if (rateLimitResponse) return rateLimitResponse;

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

  const currentUser = await findActiveUserById(authContext.userId);
  if (!currentUser) {
    return response.errorResponse(404, 'common.notFound', ctx.event);
  }

  const currentEmail = normalizeEmail(currentUser.email);
  const currentPhoneNumber = normalizePhone(currentUser.phoneNumber);

  if (emailClearRequested || phoneClearRequested) {
    if (!currentEmail && !currentPhoneNumber) {
      return response.errorResponse(400, 'user.errors.noContactToRemove', ctx.event);
    }

    const nextEmail = email === undefined ? currentEmail : normalizedEmail;
    const nextPhoneNumber = phoneNumber === undefined ? currentPhoneNumber : normalizedPhoneNumber;
    if (!nextEmail && !nextPhoneNumber) {
      return response.errorResponse(400, 'user.errors.contactRequired', ctx.event);
    }
  }

  if (normalizedEmail || normalizedPhoneNumber) {
    const conflict = (await User.findOne({
      $or: [
        ...(normalizedEmail ? [{ email: normalizedEmail }] : []),
        ...(normalizedPhoneNumber ? [{ phoneNumber: normalizedPhoneNumber }] : []),
      ],
      _id: { $ne: authContext.userId },
      deleted: false,
    }).lean()) as UserDocument | null;

    if (conflict) {
      const errorKey =
        normalizedEmail && conflict.email === normalizedEmail
          ? 'user.errors.emailExists'
          : 'user.errors.phoneExists';

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
    updatedUser = (await User.findOneAndUpdate(
      { _id: authContext.userId, deleted: false },
      updateOperation,
      { returnDocument: 'after', lean: true }
    )) as UserDocument | null;
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

      return response.errorResponse(409, errorKey, ctx.event);
    }

    throw error;
  }

  if (!updatedUser) {
    return response.errorResponse(404, 'common.notFound', ctx.event);
  }

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
