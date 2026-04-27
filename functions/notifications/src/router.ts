import { createRouter } from '@aws-ddd-api/shared';
import type { RouteHandler } from '../../../types/lambda';
import { response } from './utils/response';
import { handleProxyAny, handleProxyRoot } from './services/notifications';

const routes: Record<string, RouteHandler> = {
  '/notifications': handleProxyRoot,
  '/notifications/{proxy+}': handleProxyAny,
};

export const routeRequest = createRouter(routes, { response });
