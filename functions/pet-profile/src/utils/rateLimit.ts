import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { requireMongoRateLimit } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { response } from './response';

export async function applyRateLimit(params: {
  action: string;
  event: RouteContext['event'];
  identifier?: string | number | null;
  limit: number;
  windowSeconds: number;
}): Promise<APIGatewayProxyResult | null> {
  try {
    await requireMongoRateLimit({
      action: params.action,
      event: params.event,
      identifier: params.identifier,
      limit: params.limit,
      mongoose,
      windowSeconds: params.windowSeconds,
    });

    return null;
  } catch (error) {
    const statusCode = (error as { statusCode?: unknown })?.statusCode;
    if (statusCode !== 429) {
      throw error;
    }

    const retryAfterSeconds = (error as { result?: { retryAfterSeconds?: number } })?.result?.retryAfterSeconds;
    return response.errorResponse(
      429,
      'common.rateLimited',
      params.event,
      retryAfterSeconds ? { 'retry-after': String(retryAfterSeconds) } : undefined
    );
  }
}
