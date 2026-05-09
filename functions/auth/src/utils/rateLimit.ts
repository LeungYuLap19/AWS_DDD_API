import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import {
  recordMongoRateLimitFailure,
  requireMongoRateLimit,
  requireMongoRateLimitNotInCooldown,
} from '@aws-ddd-api/shared';
import type { RateLimitPolicy, RateLimitScope } from '@aws-ddd-api/shared';
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

/**
 * Failure-counter parameters shared by `requireFailureCooldown` and
 * `recordFailure`. Use the same `action`, `identifier`, `threshold` and
 * `cooldownSeconds` on both sides for a given flow.
 */
type FailureCooldownParams = {
  accountId?: string | number | null;
  action: string;
  cooldownSeconds: number;
  event: RouteContext['event'];
  identifier?: string | number | null;
  scope?: RateLimitScope;
  threshold: number;
};

/**
 * Throws a 429 response if the failure cooldown for this identifier/scope is
 * already exceeded. Call this at the top of the sensitive handler so genuine
 * requests do not consume the failure quota.
 */
export async function requireFailureCooldown(
  params: FailureCooldownParams
): Promise<APIGatewayProxyResult | null> {
  try {
    await requireMongoRateLimitNotInCooldown({
      accountId: params.accountId,
      action: params.action,
      cooldownSeconds: params.cooldownSeconds,
      event: params.event,
      identifier: params.identifier,
      mongoose,
      scope: params.scope,
      threshold: params.threshold,
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

/**
 * Records one failure (e.g. wrong password / invalid OTP / bad refresh token)
 * against the configured cooldown bucket. The next request that calls
 * `requireFailureCooldown` will be rejected once `threshold` is reached.
 *
 * Errors are swallowed: a transient counter write failure must not change the
 * outer authentication failure response.
 */
export async function recordFailure(params: FailureCooldownParams): Promise<void> {
  try {
    await recordMongoRateLimitFailure({
      accountId: params.accountId,
      action: params.action,
      cooldownSeconds: params.cooldownSeconds,
      event: params.event,
      failOpen: true,
      identifier: params.identifier,
      mongoose,
      scope: params.scope,
      threshold: params.threshold,
    });
  } catch {
    // Best-effort: do not let counter persistence failures alter the auth
    // failure response surface.
  }
}
