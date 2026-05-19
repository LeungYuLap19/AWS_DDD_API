import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { requireMongoRateLimit, type RateLimitPolicy } from '@aws-ddd-api/shared/rate-limit/mongo';
import type { RouteContext } from '../../../../types/lambda';
import { response } from './response';

/**
 * Parameters accepted by `applyRateLimit`.
 *
 * Provide either:
 * - `policies` for a layered limit (per-IP, per-identifier, per-account, etc.), or
 * - `limit` + `windowSeconds` for the legacy single-bucket limit (IP + identifier).
 *
 * `accountId` is optional and only consumed by `account`-scoped policies.
 */
type ApplyRateLimitParams = {
  accountId?: string | number | null;
  action: string;
  event: RouteContext['event'];
  identifier?: string | number | null;
  limit?: number;
  policies?: RateLimitPolicy[];
  windowSeconds?: number;
};

export async function applyRateLimit(params: ApplyRateLimitParams): Promise<APIGatewayProxyResult | null> {
  try {
    await requireMongoRateLimit({
      accountId: params.accountId,
      action: params.action,
      event: params.event,
      identifier: params.identifier,
      limit: params.limit,
      mongoose,
      policies: params.policies,
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
