import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import env from '../config/env';

type CookieCapableEvent = APIGatewayProxyEvent & {
  cookies?: string[];
};

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateRefreshToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function issueCustomAccessToken(payload: Record<string, unknown>, options: Record<string, unknown> = {}): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: '15m',
    ...options,
    algorithm: 'HS256',
  });
}

export function issueUserAccessToken(user: {
  _id: string | { toString(): string };
  email?: string;
  role?: string;
}): string {
  return issueCustomAccessToken({
    userId: user._id.toString(),
    userEmail: user.email,
    userRole: user.role,
  });
}

export function issueNgoAccessToken(
  user: {
    _id: string | { toString(): string };
    email?: string;
    role?: string;
  },
  ngo: {
    _id: string | { toString(): string };
    name?: string;
  }
): string {
  return issueCustomAccessToken({
    userId: user._id.toString(),
    userEmail: user.email,
    userRole: user.role,
    ngoId: ngo._id.toString(),
    ngoName: ngo.name,
  });
}

export async function createRefreshToken(userId: string | { toString(): string }) {
  const RefreshToken = mongoose.model('RefreshToken');
  const token = generateRefreshToken();
  const expiresAt = new Date(Date.now() + Number(env.REFRESH_TOKEN_MAX_AGE_SEC) * 1000);

  await new RefreshToken({
    userId,
    tokenHash: hashToken(token),
    createdAt: new Date(),
    lastUsedAt: new Date(),
    expiresAt,
  }).save();

  return { token, expiresAt };
}

function getCookiePath(event: APIGatewayProxyEvent): string {
  const stage = event.requestContext?.stage || '';
  if (stage) {
    return `/${stage}/auth/tokens/refresh`;
  }
  return '/auth/tokens/refresh';
}

export function buildRefreshCookie(refreshToken: string, event: APIGatewayProxyEvent): string {
  return `refreshToken=${refreshToken}; HttpOnly; Secure; SameSite=Strict; Path=${getCookiePath(event)}; Max-Age=${env.REFRESH_TOKEN_MAX_AGE_SEC}`;
}

function parseCookieString(cookieString: string): Record<string, string> {
  return cookieString
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((cookies, part) => {
      const separatorIndex = part.indexOf('=');
      if (separatorIndex === -1) {
        return cookies;
      }

      const name = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).trim();
      cookies[name] = value;
      return cookies;
    }, {});
}

export function readRefreshTokenFromEvent(event: CookieCapableEvent): {
  token: string | null;
  errorKey: string | null;
} {
  if (Array.isArray(event.cookies) && event.cookies.length > 0) {
    const cookieMap = parseCookieString(event.cookies.join('; '));
    if (cookieMap.refreshToken) {
      return { token: cookieMap.refreshToken, errorKey: null };
    }

    return { token: null, errorKey: 'auth.refresh.invalidRefreshTokenCookie' };
  }

  const cookieHeader = event.headers?.cookie || event.headers?.Cookie;
  if (!cookieHeader) {
    return { token: null, errorKey: 'auth.refresh.missingRefreshToken' };
  }

  const cookieMap = parseCookieString(cookieHeader);
  if (!cookieMap.refreshToken) {
    return { token: null, errorKey: 'auth.refresh.invalidRefreshTokenCookie' };
  }

  return { token: cookieMap.refreshToken, errorKey: null };
}

export { hashToken };
