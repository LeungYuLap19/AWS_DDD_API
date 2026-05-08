import { createRouter } from '@aws-ddd-api/shared';
import { response } from './utils/response';

const routes = {
  'GET /commerce/orders': () => import('./services/orders').then(m => m.handleGetOrders),
  'POST /commerce/orders': () => import('./services/orders').then(m => m.handleCreateOrder),
  'GET /commerce/orders/operations': () => import('./services/orders').then(m => m.handleGetOperations),
  'GET /commerce/orders/{tempId}': () => import('./services/orders').then(m => m.handleGetOrderByTempId),
};

export const routeRequest = createRouter(routes, { response });
