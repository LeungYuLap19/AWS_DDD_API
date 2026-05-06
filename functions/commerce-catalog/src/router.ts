import { createRouter } from '@aws-ddd-api/shared';
import type { RouteHandler } from '../../../types/lambda';
import { response } from './utils/response';
import { handleProxyAny, handleProxyRoot } from './services/catalog';

const routes: Record<string, RouteHandler> = {
  '/commerce/catalog': handleProxyRoot,
  '/commerce/catalog/{proxy+}': handleProxyAny,
  '/commerce/storefront': handleProxyRoot,
};

export const routeRequest = createRouter(routes, { response });
