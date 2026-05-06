import type { APIGatewayProxyResult } from 'aws-lambda';
import { getAuthContext, logError, parseBody, requireAuthContext } from '@aws-ddd-api/shared';
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

function getRateLimitIdentifier(event: RouteContext['event']): string | null {
  const auth = getAuthContext(event);
  return auth?.userEmail ?? auth?.userId ?? null;
}

export async function getToken({ event }: RouteContext): Promise<APIGatewayProxyResult> {
  requireAuthContext(event);
  try {
    await connectToMongoDB();

    const rateLimitResult = await applyRateLimit({
      action: 'logistics.getToken',
      event,
      identifier: getRateLimitIdentifier(event),
      limit: 10,
      windowSeconds: 300,
    });
    if (rateLimitResult) return rateLimitResult;

    const bearerToken = await fetchAddressToken();
    return response.successResponse(200, event, { bearer_token: bearerToken });
  } catch (error) {
    logError('Failed to get SF address token', {
      scope: 'services.sfMetadata.getToken',
      extra: { error },
    });
    return response.errorResponse(500, 'common.internalError', event);
  }
}

export async function getArea({ event, body }: RouteContext): Promise<APIGatewayProxyResult> {
  try {
    await connectToMongoDB();

    const rateLimitResult = await applyRateLimit({
      action: 'logistics.getArea',
      event,
      identifier: getRateLimitIdentifier(event),
      limit: 30,
      windowSeconds: 300,
    });
    if (rateLimitResult) return rateLimitResult;

    const parsed = parseBody(body, getAreaSchema);
    if (!parsed.ok) return response.errorResponse(parsed.statusCode, parsed.errorKey, event);

    const areaList = await fetchAreaList(parsed.data.token);
    return response.successResponse(200, event, { area_list: areaList });
  } catch (error) {
    logError('Failed to get SF area list', {
      scope: 'services.sfMetadata.getArea',
      extra: { error },
    });
    return response.errorResponse(500, 'common.internalError', event);
  }
}

export async function getNetCode({ event, body }: RouteContext): Promise<APIGatewayProxyResult> {
  try {
    await connectToMongoDB();

    const rateLimitResult = await applyRateLimit({
      action: 'logistics.getNetCode',
      event,
      identifier: getRateLimitIdentifier(event),
      limit: 30,
      windowSeconds: 300,
    });
    if (rateLimitResult) return rateLimitResult;

    const parsed = parseBody(body, getNetCodeSchema);
    if (!parsed.ok) return response.errorResponse(parsed.statusCode, parsed.errorKey, event);

    const netCode = await fetchNetCodeList(parsed.data);
    return response.successResponse(200, event, { netCode });
  } catch (error) {
    logError('Failed to get SF net codes', {
      scope: 'services.sfMetadata.getNetCode',
      extra: { error },
    });
    return response.errorResponse(500, 'common.internalError', event);
  }
}

export async function getPickupLocations({
  event,
  body,
}: RouteContext): Promise<APIGatewayProxyResult> {
  try {
    await connectToMongoDB();

    const rateLimitResult = await applyRateLimit({
      action: 'logistics.getPickupLocations',
      event,
      identifier: getRateLimitIdentifier(event),
      limit: 30,
      windowSeconds: 300,
    });
    if (rateLimitResult) return rateLimitResult;

    const parsed = parseBody(body, getPickupLocationsSchema);
    if (!parsed.ok) return response.errorResponse(parsed.statusCode, parsed.errorKey, event);

    const addresses = await fetchPickupAddresses(parsed.data);
    return response.successResponse(200, event, { addresses });
  } catch (error) {
    logError('Failed to get SF pickup locations', {
      scope: 'services.sfMetadata.getPickupLocations',
      extra: { error },
    });
    return response.errorResponse(500, 'common.internalError', event);
  }
}

