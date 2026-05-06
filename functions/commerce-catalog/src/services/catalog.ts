import type { APIGatewayProxyResult } from 'aws-lambda';
import type { RouteContext } from '../../../../types/lambda';
import { response } from '../utils/response';

export async function handleProxyRoot(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  return response.successResponse(200, ctx.event);
}

export async function handleProxyAny(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  return response.successResponse(200, ctx.event);
}
