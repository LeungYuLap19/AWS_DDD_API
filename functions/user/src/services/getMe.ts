import type { APIGatewayProxyResult } from 'aws-lambda';
import { requireAuthContext } from '@aws-ddd-api/shared/auth/context';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { ensureUserModel } from '../config/models';
import { response } from '../utils/response';
import { sanitizeUser } from '../utils/sanitize';

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
