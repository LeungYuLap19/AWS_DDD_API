import { createRouter } from '@aws-ddd-api/shared';
import type { RouteHandler } from '../../../types/lambda';
import { response } from './utils/response';
import { handleProxyAny, handleProxyRoot } from './services/fulfillment';

const routes: Record<string, RouteHandler> = {
  '/commerce/fulfillment': handleProxyRoot,
  '/commerce/fulfillment/{proxy+}': handleProxyAny,
  '/commerce/commands/{proxy+}': handleProxyAny,
};

export const routeRequest = createRouter(routes, { response });
