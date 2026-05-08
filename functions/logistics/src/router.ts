import { createRouter } from '@aws-ddd-api/shared';
import { response } from './utils/response';

const routes = {
  'POST /logistics/token': () => import('./services/sfMetadata').then(m => m.getToken),
  'POST /logistics/lookups/areas': () => import('./services/sfMetadata').then(m => m.getArea),
  'POST /logistics/lookups/net-codes': () => import('./services/sfMetadata').then(m => m.getNetCode),
  'POST /logistics/lookups/pickup-locations': () => import('./services/sfMetadata').then(m => m.getPickupLocations),
  'POST /logistics/shipments': () => import('./services/sfShipment').then(m => m.createShipment),
  'POST /logistics/cloud-waybill': () => import('./services/sfWaybill').then(m => m.printCloudWaybill),
};

export const routeRequest = createRouter(routes, { response });
