import { createRouter } from '@aws-ddd-api/shared';
import type { RouteHandler } from '../../../types/lambda';
import { response } from './utils/response';
import { handleProxyAny, handleProxyRoot } from './services/orders';

const routes: Record<string, RouteHandler> = {
  '/commerce/orders': handleProxyRoot,
  '/commerce/orders/{proxy+}': handleProxyAny,
};

export const routeRequest = createRouter(routes, { response });
