import type { APIGatewayTokenAuthorizerEvent } from 'aws-lambda';
import jwt from 'jsonwebtoken';

type PolicyEffect = 'Allow' | 'Deny';

type PolicyInput = {
  principalId: string;
  effect: PolicyEffect;
  resource: string;
  context?: Record<string, unknown>;
};

function buildPolicy({ principalId, effect, resource, context = {} }: PolicyInput) {
  return {
    principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: effect,
          Resource: resource,
        },
      ],
    },
    context: Object.fromEntries(
      Object.entries(context).map(([key, value]) => [key, value == null ? '' : String(value)])
    ),
  };
}

function getBearerToken(headerValue: unknown): string | null {
  if (!headerValue) {
    return null;
  }

  const raw = String(headerValue).trim();
  const match = /^Bearer\s+(.+)$/.exec(raw);
  return match ? match[1] : null;
}

function isTrue(value: unknown, defaultValue = false): boolean {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

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
    const decoded = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] }) as {
      [key: string]: unknown;
      userId?: string;
      userEmail?: string;
      userRole?: string;
      ngoId?: string;
      ngoName?: string;
      email?: string;
      role?: string;
      sub?: string;
    };
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
