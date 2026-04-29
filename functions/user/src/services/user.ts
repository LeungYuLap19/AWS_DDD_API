import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { getFirstZodIssueMessage, requireAuthContext } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { userPatchBodySchema } from '../zodSchema/userPatchBodySchema';
import { normalizeEmail, normalizePhone } from '../utils/normalize';
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

export async function handleGetMe(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);
  await connectToMongoDB();

  const user = await findActiveUserById(authContext.userId);
  if (!user) {
    return response.errorResponse(404, 'userRoutes.errors.getUserNotFound', ctx.event);
  }

  return response.successResponse(200, ctx.event, {
    message: 'Success',
    user: sanitizeUser(user),
  });
}

export async function handlePatchMe(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);
  const parsed = userPatchBodySchema.safeParse(ctx.body);
  if (!parsed.success) {
    return response.errorResponse(400, getFirstZodIssueMessage(parsed.error), ctx.event);
  }

  await connectToMongoDB();

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
          ? 'userRoutes.errors.emailExists'
          : 'userRoutes.errors.phoneExists';

      return response.errorResponse(409, errorKey, ctx.event);
    }
  }

  const updateFields: Record<string, unknown> = {};
  if (firstName !== undefined) updateFields.firstName = firstName;
  if (lastName !== undefined) updateFields.lastName = lastName;
  if (district !== undefined) updateFields.district = district;
  if (image !== undefined) updateFields.image = image;
  if (email !== undefined) updateFields.email = normalizedEmail;
  if (phoneNumber !== undefined) updateFields.phoneNumber = normalizedPhoneNumber;
  if (birthday !== undefined) updateFields.birthday = birthday ? new Date(birthday) : null;

  const updatedUser = (await User.findOneAndUpdate(
    { _id: authContext.userId, deleted: false },
    { $set: updateFields },
    { returnDocument: 'after', lean: true }
  )) as UserDocument | null;

  if (!updatedUser) {
    return response.errorResponse(404, 'userRoutes.errors.putUserNotFound', ctx.event);
  }

  return response.successResponse(200, ctx.event, {
    message: 'Success',
    user: sanitizeUser(updatedUser),
  });
}

export async function handleDeleteMe(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);
  await connectToMongoDB();

  const User = mongoose.model('User');
  const RefreshToken = mongoose.model('RefreshToken');
  const user = await findActiveUserById(authContext.userId);

  if (!user) {
    return response.errorResponse(404, 'userRoutes.errors.getUserNotFound', ctx.event);
  }

  await Promise.all([
    User.updateOne({ _id: authContext.userId }, { $set: { deleted: true } }),
    RefreshToken.deleteMany({ userId: authContext.userId }),
  ]);

  return response.successResponse(200, ctx.event, {
    message: 'User deleted successfully',
    userId: user._id,
  });
}
