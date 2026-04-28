import type { APIGatewayProxyResult } from 'aws-lambda';
import { getFirstZodIssueMessage } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { challengeBodySchema } from '../zodSchema/challengeBodySchema';
import { verifyChallengeBodySchema } from '../zodSchema/verifyChallengeBodySchema';
import { response } from '../utils/response';

function notImplemented(
  event: RouteContext['event'],
  route: string
): APIGatewayProxyResult {
  return response.errorResponse(501, 'auth.notImplemented', event, {
    'x-route-key': route,
  });
}

export async function handleCreateChallenge(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const parsed = challengeBodySchema.safeParse(ctx.body);
  if (!parsed.success) {
    return response.errorResponse(400, getFirstZodIssueMessage(parsed.error), ctx.event);
  }

  if ('email' in parsed.data) {
    return notImplemented(ctx.event, 'POST /auth/challenges');
  }

  return notImplemented(ctx.event, 'POST /auth/challenges');
}

export async function handleVerifyChallenge(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const parsed = verifyChallengeBodySchema.safeParse(ctx.body);
  if (!parsed.success) {
    return response.errorResponse(400, getFirstZodIssueMessage(parsed.error), ctx.event);
  }

  if ('email' in parsed.data) {
    return notImplemented(ctx.event, 'POST /auth/challenges/verify');
  }

  return notImplemented(ctx.event, 'POST /auth/challenges/verify');
}

export async function handleCreateUserRegistration(
  ctx: RouteContext
): Promise<APIGatewayProxyResult> {
  return notImplemented(ctx.event, 'POST /auth/registrations/user');
}

export async function handleCreateNgoRegistration(
  ctx: RouteContext
): Promise<APIGatewayProxyResult> {
  return notImplemented(ctx.event, 'POST /auth/registrations/ngo');
}

export async function handleRefreshToken(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  return notImplemented(ctx.event, 'POST /auth/tokens/refresh');
}
