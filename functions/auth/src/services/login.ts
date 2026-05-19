import type { APIGatewayProxyResult } from 'aws-lambda';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { parseBody } from '@aws-ddd-api/shared/validation/zod';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { ngoLoginBodySchema } from '../zodSchema/ngoLoginBodySchema';
import { normalizeEmail } from '../utils/normalize';
import { applyRateLimit, recordFailure, requireFailureCooldown } from '../utils/rateLimit';
import { response } from '../utils/response';
import {
  buildRefreshCookie,
  createRefreshToken,
  issueNgoAccessToken,
} from '../utils/token';

type NgoLoginUser = {
  _id: { toString(): string };
  email?: string;
  password?: string;
  role?: string;
  verified?: boolean;
};

/**
 * Authenticates an NGO user with email/password, applies both request and
 * failure-cooldown limits, then issues a fresh access token plus refresh
 * cookie when the NGO membership is active and verified.
 */
export async function handleNgoLogin(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const parsed = parseBody(ctx.body, ngoLoginBodySchema);
  if (!parsed.ok) {
    return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
  }

  await connectToMongoDB();

  const email = normalizeEmail(parsed.data.email);
  if (!email) {
    return response.errorResponse(400, 'auth.login.ngo.invalidEmailFormat', ctx.event);
  }

  const rateLimitResponse = await applyRateLimit({
    action: 'auth.login.ngo',
    event: ctx.event,
    identifier: email,
    // ip+identifier omitted: with identifier limit ≤ ip+identifier limit, the
    // composite lane is dead weight (it can never trip first).
    policies: [
      { scope: 'ip', limit: 60, windowSeconds: 15 * 60 },
      { scope: 'identifier', limit: 10, windowSeconds: 15 * 60 },
    ],
  });
  if (rateLimitResponse) return rateLimitResponse;

  // Reject early if too many bad-credential failures have already accumulated
  // for this email regardless of IP. Genuine logins do not consume this quota.
  const cooldownResponse = await requireFailureCooldown({
    action: 'auth.login.ngo.fail',
    cooldownSeconds: 15 * 60,
    event: ctx.event,
    identifier: email,
    threshold: 5,
  });
  if (cooldownResponse) return cooldownResponse;

  const User = mongoose.model('User');
  const user = await User.findOne({
    email,
    role: 'ngo',
    deleted: false,
  }).lean() as NgoLoginUser | null;

  if (!user || !user.password || !(await bcrypt.compare(parsed.data.password, user.password))) {
    await recordFailure({
      action: 'auth.login.ngo.fail',
      cooldownSeconds: 15 * 60,
      event: ctx.event,
      identifier: email,
      threshold: 5,
    });
    return response.errorResponse(401, 'auth.login.ngo.invalidUserCredential', ctx.event);
  }

  const NgoUserAccess = mongoose.model('NgoUserAccess');
  const ngoUserAccess = await NgoUserAccess.findOne({
    userId: user._id,
    isActive: true,
  }).select('ngoId').lean() as { ngoId?: { toString(): string } } | null;

  if (!ngoUserAccess?.ngoId) {
    return response.errorResponse(403, 'auth.login.ngo.userNGONotFound', ctx.event);
  }

  const NGO = mongoose.model('NGO');
  const ngo = await NGO.findOne({ _id: ngoUserAccess.ngoId })
    .select('_id name isActive isVerified')
    .lean() as {
      _id: { toString(): string };
      name?: string;
      isActive?: boolean;
      isVerified?: boolean;
    } | null;

  if (!ngo) {
    return response.errorResponse(500, 'auth.login.ngo.NGONotFound', ctx.event);
  }

  if (!ngo.isActive || !ngo.isVerified) {
    return response.errorResponse(403, 'auth.login.ngo.ngoApprovalRequired', ctx.event);
  }

  const token = issueNgoAccessToken(user, ngo);
  const { token: refreshToken } = await createRefreshToken(user._id);

  return response.successResponse(200, ctx.event, {
    message: 'auth.login.ngo.successful',
    data: { userId: user._id, role: user.role, isVerified: user.verified, token, ngoId: ngo._id },
  }, {
    'Set-Cookie': buildRefreshCookie(refreshToken, ctx.event),
  });
}
