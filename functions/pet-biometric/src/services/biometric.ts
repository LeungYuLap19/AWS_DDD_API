import type { APIGatewayProxyResult } from 'aws-lambda';
import type { RouteContext } from '../../../../types/lambda';
import { response } from '../utils/response';

/** Lightweight root health/proxy endpoint for the pet-biometric Lambda. */
export async function handleProxyRoot(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  return response.successResponse(200, ctx.event);
}

/** Catch-all health/proxy endpoint for unmatched pet-biometric subpaths. */
export async function handleProxyAny(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  return response.successResponse(200, ctx.event);
}
