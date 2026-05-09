import type { APIGatewayProxyResult } from 'aws-lambda';
import { parseBody } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import {
  fetchAddressToken,
  fetchAreaList,
  fetchNetCodeList,
  fetchPickupAddresses,
} from '../config/sfAddressClient';
import { applyRateLimit } from '../utils/rateLimit';
import { response } from '../utils/response';
import {
  getAreaSchema,
  getNetCodeSchema,
  getPickupLocationsSchema,
} from '../zodSchema/logisticsSchema';

/**
 * Retrieves an address-service bearer token from SF Express. This route is
 * intentionally public, so only an IP-scoped rate limit is applied.
 */
export async function getToken({ event }: RouteContext): Promise<APIGatewayProxyResult> {
  await connectToMongoDB();

  const rateLimitResult = await applyRateLimit({
    action: 'logistics.getToken',
    event,
    identifier: null,
    policies: [
      // Public unauthenticated route: only the per-IP lane is meaningful.
      { scope: 'ip', limit: 10, windowSeconds: 300 },
    ],
  });
  if (rateLimitResult) return rateLimitResult;

  let bearerToken: unknown;
  try {
    bearerToken = await fetchAddressToken();
  } catch {
    return response.errorResponse(502, 'logistics.sfApiError', event);
  }
  return response.successResponse(200, event, { message: 'success.retrieved', data: { bearerToken } });
}

/**
 * Resolves the SF area list for a previously issued address token after body
 * validation and public-route throttling.
 */
export async function getArea({ event, body }: RouteContext): Promise<APIGatewayProxyResult> {
  const parsed = parseBody(body, getAreaSchema);
  if (!parsed.ok) return response.errorResponse(parsed.statusCode, parsed.errorKey, event);

  await connectToMongoDB();

  const rateLimitResult = await applyRateLimit({
    action: 'logistics.getArea',
    event,
    identifier: null,
    policies: [
      { scope: 'ip', limit: 30, windowSeconds: 300 },
    ],
  });
  if (rateLimitResult) return rateLimitResult;

  let areaList: unknown;
  try {
    areaList = await fetchAreaList(parsed.data.token);
  } catch {
    return response.errorResponse(502, 'logistics.sfApiError', event);
  }
  return response.successResponse(200, event, { message: 'success.retrieved', data: { areaList } });
}

/**
 * Resolves SF net-code metadata for the supplied address payload. Provider
 * failures are normalized into the shared `logistics.sfApiError` contract.
 */
export async function getNetCode({ event, body }: RouteContext): Promise<APIGatewayProxyResult> {
  const parsed = parseBody(body, getNetCodeSchema);
  if (!parsed.ok) return response.errorResponse(parsed.statusCode, parsed.errorKey, event);

  await connectToMongoDB();

  const rateLimitResult = await applyRateLimit({
    action: 'logistics.getNetCode',
    event,
    identifier: null,
    policies: [
      { scope: 'ip', limit: 30, windowSeconds: 300 },
    ],
  });
  if (rateLimitResult) return rateLimitResult;

  let netCode: unknown;
  try {
    netCode = await fetchNetCodeList(parsed.data);
  } catch {
    return response.errorResponse(502, 'logistics.sfApiError', event);
  }
  return response.successResponse(200, event, { message: 'success.retrieved', data: { netCode } });
}

/**
 * Returns pickup addresses from SF Express for a validated location request.
 * The call remains public but is capped by IP to bound third-party API abuse.
 */
export async function getPickupLocations({
  event,
  body,
}: RouteContext): Promise<APIGatewayProxyResult> {
  const parsed = parseBody(body, getPickupLocationsSchema);
  if (!parsed.ok) return response.errorResponse(parsed.statusCode, parsed.errorKey, event);

  await connectToMongoDB();

  const rateLimitResult = await applyRateLimit({
    action: 'logistics.getPickupLocations',
    event,
    identifier: null,
    policies: [
      { scope: 'ip', limit: 30, windowSeconds: 300 },
    ],
  });
  if (rateLimitResult) return rateLimitResult;

  let addresses: unknown;
  try {
    addresses = await fetchPickupAddresses(parsed.data);
  } catch {
    return response.errorResponse(502, 'logistics.sfApiError', event);
  }
  return response.successResponse(200, event, { message: 'success.retrieved', data: { addresses } });
}
