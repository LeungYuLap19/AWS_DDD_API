import type { APIGatewayProxyResult } from 'aws-lambda';
import { requireAuthContext } from '@aws-ddd-api/shared/auth/context';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { ensureRefreshTokenModel, ensureUserModel } from '../config/models';
import { applyRateLimit } from '../utils/rateLimit';
import { response } from '../utils/response';

type UserDocument = {
  _id: { toString(): string };
  deleted?: boolean;
  [key: string]: unknown;
};

async function findActiveUserById(userId: string): Promise<UserDocument | null> {
  const User = ensureUserModel();
  return (await User.findOne({ _id: userId, deleted: false }).lean()) as UserDocument | null;
}

/**
 * Soft-deletes the authenticated user's account and clears all refresh-token
 * sessions for that user in the same request.
 */
export async function handleDeleteMe(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);
  await connectToMongoDB();

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

  const User = ensureUserModel();
  const RefreshToken = ensureRefreshTokenModel();
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
