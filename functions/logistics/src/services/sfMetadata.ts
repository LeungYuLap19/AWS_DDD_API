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

export async function getToken({ event }: RouteContext): Promise<APIGatewayProxyResult> {
  await connectToMongoDB();

  const rateLimitResult = await applyRateLimit({
    action: 'logistics.getToken',
    event,
    identifier: null,
    limit: 10,
    windowSeconds: 300,
  });
  if (rateLimitResult) return rateLimitResult;

  const bearerToken = await fetchAddressToken();
  return response.successResponse(200, event, { message: 'success.retrieved', data: { bearerToken } });
}

export async function getArea({ event, body }: RouteContext): Promise<APIGatewayProxyResult> {
  const parsed = parseBody(body, getAreaSchema);
  if (!parsed.ok) return response.errorResponse(parsed.statusCode, parsed.errorKey, event);

  await connectToMongoDB();

  const rateLimitResult = await applyRateLimit({
    action: 'logistics.getArea',
    event,
    identifier: null,
    limit: 30,
    windowSeconds: 300,
  });
  if (rateLimitResult) return rateLimitResult;

  const areaList = await fetchAreaList(parsed.data.token);
  return response.successResponse(200, event, { message: 'success.retrieved', data: { areaList } });
}

export async function getNetCode({ event, body }: RouteContext): Promise<APIGatewayProxyResult> {
  const parsed = parseBody(body, getNetCodeSchema);
  if (!parsed.ok) return response.errorResponse(parsed.statusCode, parsed.errorKey, event);

  await connectToMongoDB();

  const rateLimitResult = await applyRateLimit({
    action: 'logistics.getNetCode',
    event,
    identifier: null,
    limit: 30,
    windowSeconds: 300,
  });
  if (rateLimitResult) return rateLimitResult;

  const netCode = await fetchNetCodeList(parsed.data);
  return response.successResponse(200, event, { message: 'success.retrieved', data: { netCode } });
}

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
    limit: 30,
    windowSeconds: 300,
  });
  if (rateLimitResult) return rateLimitResult;

  const addresses = await fetchPickupAddresses(parsed.data);
  return response.successResponse(200, event, { message: 'success.retrieved', data: { addresses } });
}

