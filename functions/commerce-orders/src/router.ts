import { createRouter } from '@aws-ddd-api/shared';
import type { RouteHandler } from '../../../types/lambda';
import { response } from './utils/response';
import { handleGetOrders, handleCreateOrder, handleGetOperations, handleGetOrderByTempId } from './services/orders';

const routes: Record<string, RouteHandler> = {
  'GET /commerce/orders': handleGetOrders,
  'POST /commerce/orders': handleCreateOrder,
  'GET /commerce/orders/operations': handleGetOperations,
  'GET /commerce/orders/{tempId}': handleGetOrderByTempId,
};

export const routeRequest = createRouter(routes, { response });
