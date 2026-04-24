import type { APIGatewayTokenAuthorizerEvent } from 'aws-lambda';
import jwt from 'jsonwebtoken';
import { buildPolicy, getBearerToken, isTrue } from '@aws-ddd-api/shared';

export async function handler(event: APIGatewayTokenAuthorizerEvent) {
  const methodArn = event.methodArn || '*';
  const bypass = isTrue(process.env.AUTH_BYPASS, false);

  if (bypass) {
    return buildPolicy({
      principalId: 'local-bypass',
      effect: 'Allow',
      resource: methodArn,
      context: {
        authMode: 'bypass',
        stage: process.env.STAGE_NAME || 'development',
        userId: 'dev-user-id',
        userEmail: 'dev@test.com',
        userRole: 'developer',
      },
    });
  }

  const token = getBearerToken(event.authorizationToken);
  const jwtSecret = process.env.JWT_SECRET || '';

  if (!token || !jwtSecret) {
    return buildPolicy({
      principalId: 'unauthorized',
      effect: 'Deny',
      resource: methodArn,
      context: {
        authMode: 'jwt',
        reason: !token ? 'missing-token' : 'missing-jwt-secret',
      },
    });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
    const userId = decoded.userId || decoded.sub;

    if (!userId) {
      return buildPolicy({
        principalId: 'unauthorized',
        effect: 'Deny',
        resource: methodArn,
        context: {
          authMode: 'jwt',
          reason: 'missing-user-claim',
        },
      });
    }

    return buildPolicy({
      principalId: String(userId),
      effect: 'Allow',
      resource: methodArn,
      context: {
        authMode: 'jwt',
        stage: process.env.STAGE_NAME || 'development',
        userId,
        userEmail: decoded.userEmail || decoded.email || '',
        userRole: decoded.userRole || decoded.role || '',
        ngoId: decoded.ngoId || '',
        ngoName: decoded.ngoName || '',
      },
    });
  } catch (_error) {
    return buildPolicy({
      principalId: 'unauthorized',
      effect: 'Deny',
      resource: methodArn,
      context: {
        authMode: 'jwt',
        reason: 'jwt-verification-failed',
      },
    });
  }
};
