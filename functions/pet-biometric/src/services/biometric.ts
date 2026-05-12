import type { APIGatewayProxyResult } from 'aws-lambda';
import type { RouteContext } from '../../../../types/lambda';
import { response } from '../utils/response';

export async function handleGetBiometric(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  return response.successResponse(200, ctx.event);
}

export async function handleDeleteBiometric(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  return response.successResponse(200, ctx.event);
}

export async function handleRegisterBiometric(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  return response.successResponse(200, ctx.event);
}

export async function handleVerifyBiometric(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  return response.successResponse(200, ctx.event);
}