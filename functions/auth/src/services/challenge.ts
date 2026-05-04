import type { APIGatewayProxyResult } from 'aws-lambda';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { getBearerToken, parseBody } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import env from '../config/env';
import { sendMail } from '../config/mail';
import { checkSmsVerification, createSmsVerification } from '../config/twilio';
import { challengeBodySchema } from '../zodSchema/challengeBodySchema';
import { verifyChallengeBodySchema } from '../zodSchema/verifyChallengeBodySchema';
import { normalizeEmail, normalizePhone } from '../utils/normalize';
import { applyRateLimit } from '../utils/rateLimit';
import { response } from '../utils/response';
import {
  buildRefreshCookie,
  createRefreshToken,
  issueUserAccessToken,
} from '../utils/token';

type MinimalUser = {
  _id: { toString(): string };
  email?: string;
  role?: string;
  verified?: boolean;
  phoneNumber?: string;
};

type OptionalAuthContext = {
  userId: string;
  userEmail?: string;
  userRole?: string;
  ngoId?: string;
  ngoName?: string;
};

function getOptionalVerifyAuthContext(event: RouteContext['event']): OptionalAuthContext | null {
  const authorizationHeader = event.headers?.authorization || event.headers?.Authorization;
  if (!authorizationHeader) {
    return null;
  }

  const token = getBearerToken(authorizationHeader);
  if (!token) {
    throw new Error('common.unauthorized');
  }

  const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as Record<string, unknown>;
  const userId = decoded.userId || decoded.sub;

  if (!userId) {
    throw new Error('common.unauthorized');
  }

  return {
    userId: String(userId),
    userEmail: typeof decoded.userEmail === 'string'
      ? decoded.userEmail
      : typeof decoded.email === 'string'
        ? decoded.email
        : undefined,
    userRole: typeof decoded.userRole === 'string'
      ? decoded.userRole
      : typeof decoded.role === 'string'
        ? decoded.role
        : undefined,
    ngoId: typeof decoded.ngoId === 'string' ? decoded.ngoId : undefined,
    ngoName: typeof decoded.ngoName === 'string' ? decoded.ngoName : undefined,
  };
}

async function createEmailChallenge(
  event: RouteContext['event'],
  body: { email: string; lang?: string }
): Promise<APIGatewayProxyResult> {
  await connectToMongoDB();

  const rateLimitResponse = await applyRateLimit({
    action: 'auth.challenge.email',
    event,
    identifier: body.email,
    limit: 5,
    windowSeconds: 300,
  });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const email = normalizeEmail(body.email);
  if (!email) {
    return response.errorResponse(400, 'common.invalidBodyParams', event);
  }

  const lang = body.lang === 'en' ? 'en' : 'zh';
  const expiresAt = new Date(Date.now() + 300_000);
  const randomNumber = crypto.randomInt(0, 1_000_000);
  const code = `000000${randomNumber}`.slice(-6);
  const codeHash = crypto.createHash('sha256').update(code).digest('hex');

  const EmailVerificationCode = mongoose.model('EmailVerificationCode');
  await EmailVerificationCode.findOneAndUpdate(
    { _id: email },
    {
      $set: {
        codeHash,
        expiresAt,
        consumedAt: null,
      },
    },
    { upsert: true }
  );

  const isZh = lang === 'zh';
  const subject = isZh
    ? 'Pet Pet Club - 帳戶驗證碼'
    : 'Pet Pet Club - Account Verification Code';
  const html = isZh
    ? `您的驗證碼 <b>${code}</b><br>此驗證碼有效期限為 5 分鐘`
    : `Your verification code is <b>${code}</b><br>The code would be valid for 5 minutes`;

  try {
    await sendMail({
      to: email,
      subject,
      html,
    });
  } catch {
    return response.errorResponse(503, 'auth.challenge.emailServiceUnavailable', event);
  }

  return response.successResponse(200, event, {
    message: 'auth.challenge.createSuccessful',
  });
}

async function createSmsChallenge(
  event: RouteContext['event'],
  body: { phoneNumber: string }
): Promise<APIGatewayProxyResult> {
  await connectToMongoDB();

  const phoneNumber = normalizePhone(body.phoneNumber);
  if (!phoneNumber) {
    return response.errorResponse(400, 'common.invalidBodyParams', event);
  }

  const rateLimitResponse = await applyRateLimit({
    action: 'auth.challenge.sms',
    event,
    identifier: phoneNumber,
    limit: 5,
    windowSeconds: 600,
  });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    await createSmsVerification(phoneNumber);
  } catch {
    return response.errorResponse(503, 'auth.challenge.smsServiceUnavailable', event);
  }

  return response.successResponse(201, event, {
    message: 'auth.challenge.createSuccessful',
  });
}

async function verifyEmailChallenge(
  event: RouteContext['event'],
  body: { email: string; code: string; lang?: string }
): Promise<APIGatewayProxyResult> {
  await connectToMongoDB();

  const rateLimitResponse = await applyRateLimit({
    action: 'auth.challenge.verify.email',
    event,
    identifier: body.email,
    limit: 10,
    windowSeconds: 300,
  });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const email = normalizeEmail(body.email);
  const code = body.code.trim();
  if (!email) {
    return response.errorResponse(400, 'common.invalidBodyParams', event);
  }

  let authContext: OptionalAuthContext | null = null;
  try {
    authContext = getOptionalVerifyAuthContext(event);
  } catch {
    return response.errorResponse(401, 'common.unauthorized', event);
  }

  const codeHash = crypto.createHash('sha256').update(code).digest('hex');
  const EmailVerificationCode = mongoose.model('EmailVerificationCode');
  const consumed = await EmailVerificationCode.findOneAndUpdate(
    {
      _id: email,
      codeHash,
      consumedAt: null,
      expiresAt: { $gt: new Date() },
    },
    { $set: { consumedAt: new Date() } },
    { new: true }
  );

  if (!consumed) {
    return response.errorResponse(400, 'auth.challenge.verificationFailed', event);
  }
  const User = mongoose.model('User');

  if (authContext?.userId) {
    const currentUser = await User.findOne({ _id: authContext.userId, deleted: false }).lean() as MinimalUser | null;
    if (!currentUser) {
      return response.errorResponse(401, 'common.unauthorized', event);
    }

    const emailOwner = await User.findOne({
      email,
      deleted: false,
      _id: { $ne: currentUser._id },
    }).lean() as MinimalUser | null;
    if (emailOwner) {
      return response.errorResponse(409, 'auth.challenge.emailAlreadyLinked', event);
    }

    await User.findOneAndUpdate(
      { _id: currentUser._id },
      { $set: { email, verified: true } }
    );

    return response.successResponse(200, event, {
      message: 'auth.challenge.verifySuccessful',
      verified: true,
      isNewUser: false,
      userId: currentUser._id,
      role: currentUser.role,
      isVerified: true,
      linked: { email },
    });
  }

  const user = await User.findOne({ email, deleted: false })
    .select('_id email role verified')
    .lean() as MinimalUser | null;

  if (!user) {
    return response.successResponse(200, event, {
      message: 'auth.challenge.verifySuccessful',
      verified: true,
      isNewUser: true,
    });
  }

  if (!user.verified) {
    await User.findOneAndUpdate(
      { _id: user._id },
      { $set: { verified: true } }
    );
  }

  const token = issueUserAccessToken(user);
  const { token: refreshToken } = await createRefreshToken(user._id);

  return response.successResponse(
    200,
    event,
    {
      message: 'auth.challenge.verifySuccessful',
      verified: true,
      isNewUser: false,
      userId: user._id,
      role: user.role,
      isVerified: true,
      token,
    },
    {
      'Set-Cookie': buildRefreshCookie(refreshToken, event),
    }
  );
}

async function verifySmsChallenge(
  event: RouteContext['event'],
  body: { phoneNumber: string; code: string }
): Promise<APIGatewayProxyResult> {
  await connectToMongoDB();

  const phoneNumber = normalizePhone(body.phoneNumber);
  if (!phoneNumber) {
    return response.errorResponse(400, 'common.invalidBodyParams', event);
  }

  const rateLimitResponse = await applyRateLimit({
    action: 'auth.challenge.verify.sms',
    event,
    identifier: phoneNumber,
    limit: 10,
    windowSeconds: 600,
  });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  let authContext: OptionalAuthContext | null = null;
  try {
    authContext = getOptionalVerifyAuthContext(event);
  } catch {
    return response.errorResponse(401, 'common.unauthorized', event);
  }

  let result;
  try {
    result = await checkSmsVerification({
      phoneNumber,
      code: body.code,
    });
  } catch {
    return response.errorResponse(503, 'auth.challenge.smsServiceUnavailable', event);
  }

  if (result.status !== 'approved') {
    const errorMap: Record<string, string> = {
      pending: 'auth.challenge.codeIncorrect',
      canceled: 'auth.challenge.codeExpired',
      expired: 'auth.challenge.codeExpired',
    };

    return response.errorResponse(400, errorMap[result.status] || 'auth.challenge.verificationFailed', event);
  }

  const SmsVerificationCode = mongoose.model('SmsVerificationCode');
  const verificationHash = crypto
    .createHash('sha256')
    .update(`${phoneNumber}:${Date.now()}`)
    .digest('hex');

  await SmsVerificationCode.findOneAndUpdate(
    { _id: phoneNumber },
    {
      $set: {
        codeHash: verificationHash,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        consumedAt: new Date(),
      },
    },
    { upsert: true }
  );

  const User = mongoose.model('User');

  if (authContext?.userId) {
    const currentUser = await User.findOne({ _id: authContext.userId, deleted: false }).lean() as MinimalUser | null;
    if (!currentUser) {
      return response.errorResponse(401, 'common.unauthorized', event);
    }

    const phoneOwner = await User.findOne({
      phoneNumber,
      deleted: false,
      _id: { $ne: currentUser._id },
    }).lean() as MinimalUser | null;
    if (phoneOwner) {
      return response.errorResponse(409, 'auth.challenge.phoneAlreadyLinked', event);
    }

    await User.findOneAndUpdate(
      { _id: currentUser._id },
      { $set: { phoneNumber, verified: true } }
    );

    return response.successResponse(200, event, {
      message: 'auth.challenge.verifySuccessful',
      verified: true,
      isNewUser: false,
      userId: currentUser._id,
      role: currentUser.role,
      isVerified: true,
      linked: { phoneNumber },
    });
  }

  const user = await User.findOne({ phoneNumber, deleted: false }).lean() as MinimalUser | null;

  if (!user) {
    return response.successResponse(200, event, {
      message: 'auth.challenge.verifySuccessful',
      verified: true,
      isNewUser: true,
    });
  }

  if (!user.verified) {
    await User.findOneAndUpdate(
      { _id: user._id },
      { $set: { verified: true } }
    );
  }

  const token = issueUserAccessToken(user);
  const { token: refreshToken } = await createRefreshToken(user._id);

  return response.successResponse(
    200,
    event,
    {
      message: 'auth.challenge.verifySuccessful',
      verified: true,
      isNewUser: false,
      userId: user._id,
      role: user.role,
      isVerified: true,
      token,
    },
    {
      'Set-Cookie': buildRefreshCookie(refreshToken, event),
    }
  );
}

export async function handleCreateChallenge(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const parsed = parseBody(ctx.body, challengeBodySchema);
  if (!parsed.ok) {
    return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
  }

  if ('email' in parsed.data) {
    return createEmailChallenge(ctx.event, parsed.data);
  }

  return createSmsChallenge(ctx.event, parsed.data);
}

export async function handleVerifyChallenge(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const parsed = parseBody(ctx.body, verifyChallengeBodySchema);
  if (!parsed.ok) {
    return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
  }

  if ('email' in parsed.data) {
    return verifyEmailChallenge(ctx.event, parsed.data);
  }

  return verifySmsChallenge(ctx.event, parsed.data);
}
