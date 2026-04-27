import { createRouter } from '@aws-ddd-api/shared';
import type { RouteHandler } from '../../../types/lambda';
import { response } from './utils/response';
import { handleProxyAny, handleProxyRoot } from './services/commerce';

const routes: Record<string, RouteHandler> = {
  '/commerce': handleProxyRoot,
  '/commerce/{proxy+}': handleProxyAny,
};

export const routeRequest = createRouter(routes, { response });
