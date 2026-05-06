import { createRouter } from '@aws-ddd-api/shared';
import type { RouteHandler } from '../../../types/lambda';
import { response } from './utils/response';
import { getToken, getArea, getNetCode, getPickupLocations } from './services/sfMetadata';
import { createShipment } from './services/sfShipment';
import { printCloudWaybill } from './services/sfWaybill';

const routes: Record<string, RouteHandler> = {
  'POST /logistics/token': getToken,
  'POST /logistics/lookups/areas': getArea,
  'POST /logistics/lookups/net-codes': getNetCode,
  'POST /logistics/lookups/pickup-locations': getPickupLocations,
  'POST /logistics/shipments': createShipment,
  'POST /logistics/cloud-waybill': printCloudWaybill,
};

export const routeRequest = createRouter(routes, { response });
