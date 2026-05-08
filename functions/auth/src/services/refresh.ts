import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import env from '../config/env';
import { response } from '../utils/response';
import {
  buildRefreshCookie,
  createRefreshToken,
  hashToken,
  issueNgoAccessToken,
  issueUserAccessToken,
  readRefreshTokenFromEvent,
} from '../utils/token';
import { applyRateLimit, recordFailure, requireFailureCooldown } from '../utils/rateLimit';

async function buildAccessTokenForUser(user: {
  _id: { toString(): string };
  email?: string;
  role?: string;
}): Promise<{ token: string | null; errorKey: string | null }> {
  if (user.role !== 'ngo') {
    return { token: issueUserAccessToken(user), errorKey: null };
  }

  const NgoUserAccess = mongoose.model('NgoUserAccess');
  const ngoUserAccess = await NgoUserAccess.findOne({
    userId: user._id,
    isActive: true,
  })
    .select('ngoId')
    .lean() as { ngoId?: { toString(): string } } | null;

  if (!ngoUserAccess?.ngoId) {
    return { token: null, errorKey: 'auth.refresh.invalidSession' };
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
    return { token: null, errorKey: 'auth.refresh.invalidSession' };
  }

  if (!ngo.isActive || !ngo.isVerified) {
    return { token: null, errorKey: 'auth.refresh.ngoApprovalRequired' };
  }

  return { token: issueNgoAccessToken(user, ngo), errorKey: null };
}

export async function handleRefreshToken(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  await connectToMongoDB();

  const refreshTokenResult = readRefreshTokenFromEvent(ctx.event);
  const rateLimitIdentifier = refreshTokenResult.token
    ? hashToken(refreshTokenResult.token)
    : 'anonymous';

  const rateLimitResponse = await applyRateLimit({
    action: 'auth.refresh',
    event: ctx.event,
    identifier: rateLimitIdentifier,
    // ip+identifier omitted: identifier and ip+identifier shared the same
    // env-driven limit, so the composite lane could never trip first.
    policies: [
      // Per-IP cap independent of token: bounds enumeration and replay across
      // many tokens from one host.
      { scope: 'ip', limit: 60, windowSeconds: 5 * 60 },
      // Per-token cap (legacy env-driven values).
      {
        scope: 'identifier',
        limit: Number(env.REFRESH_RATE_LIMIT_LIMIT),
        windowSeconds: Number(env.REFRESH_RATE_LIMIT_WINDOW_SEC),
      },
    ],
  });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  // Cool down hosts that keep presenting invalid refresh tokens.
  const cooldownResponse = await requireFailureCooldown({
    action: 'auth.refresh.fail',
    cooldownSeconds: 30 * 60,
    event: ctx.event,
    identifier: rateLimitIdentifier,
    scope: 'ip',
    threshold: 10,
  });
  if (cooldownResponse) {
    return cooldownResponse;
  }

  if (refreshTokenResult.errorKey) {
    await recordFailure({
      action: 'auth.refresh.fail',
      cooldownSeconds: 30 * 60,
      event: ctx.event,
      identifier: rateLimitIdentifier,
      scope: 'ip',
      threshold: 10,
    });
    return response.errorResponse(401, refreshTokenResult.errorKey, ctx.event);
  }

  const RefreshToken = mongoose.model('RefreshToken');
  const tokenHash = hashToken(refreshTokenResult.token as string);

  const record = await RefreshToken.findOneAndDelete({ tokenHash })
    .select('_id userId expiresAt')
    .lean() as {
      _id: { toString(): string };
      userId: { toString(): string };
      expiresAt: Date | string;
    } | null;

  if (!record || new Date(record.expiresAt).getTime() <= Date.now()) {
    await recordFailure({
      action: 'auth.refresh.fail',
      cooldownSeconds: 30 * 60,
      event: ctx.event,
      identifier: rateLimitIdentifier,
      scope: 'ip',
      threshold: 10,
    });
    return response.errorResponse(401, 'auth.refresh.invalidSession', ctx.event);
  }

  const User = mongoose.model('User');
  const user = await User.findOne({ _id: record.userId, deleted: false })
    .select('_id email role')
    .lean() as {
      _id: { toString(): string };
      email?: string;
      role?: string;
    } | null;

  if (!user) {
    await recordFailure({
      action: 'auth.refresh.fail',
      cooldownSeconds: 30 * 60,
      event: ctx.event,
      identifier: rateLimitIdentifier,
      scope: 'ip',
      threshold: 10,
    });
    return response.errorResponse(401, 'auth.refresh.invalidSession', ctx.event);
  }

  const { token: newRefreshToken } = await createRefreshToken(record.userId);
  const accessTokenResult = await buildAccessTokenForUser(user);

  if (accessTokenResult.errorKey) {
    return response.errorResponse(
      accessTokenResult.errorKey === 'auth.refresh.ngoApprovalRequired' ? 403 : 401,
      accessTokenResult.errorKey,
      ctx.event
    );
  }

  return response.successResponse(
    200,
    ctx.event,
    {
      message: 'success.completed',
      data: { accessToken: accessTokenResult.token, id: user._id.toString() },
    },
    {
      'Set-Cookie': buildRefreshCookie(newRefreshToken, ctx.event),
    }
  );
}
