import type { APIGatewayProxyResult } from 'aws-lambda';
import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { ngoLoginBodySchema } from '../zodSchema/ngoLoginBodySchema';
import { normalizeEmail } from '../utils/normalize';
import { applyRateLimit } from '../utils/rateLimit';
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

export async function handleNgoLogin(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const parsed = ngoLoginBodySchema.safeParse(ctx.body);
  if (!parsed.success) {
    return response.errorResponse(400, parsed.error.issues[0]?.message || 'common.invalidBodyParams', ctx.event);
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
    limit: 10,
    windowSeconds: 15 * 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  const User = mongoose.model('User');
  const user = await User.findOne({
    email,
    role: 'ngo',
    deleted: false,
  }).lean() as NgoLoginUser | null;

  if (!user || !user.password || !(await bcrypt.compare(parsed.data.password, user.password))) {
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
    userId: user._id,
    role: user.role,
    isVerified: user.verified,
    token,
    ngoId: ngo._id,
  }, {
    'Set-Cookie': buildRefreshCookie(refreshToken, ctx.event),
  });
}
