import { createRouter } from '@aws-ddd-api/shared';
import type { RouteHandler } from '../../../types/lambda';
import { response } from './utils/response';
import { handleProxyAny, handleProxyRoot } from './services/user';

const routes: Record<string, RouteHandler> = {
  '/user': handleProxyRoot,
  '/user/{proxy+}': handleProxyAny,
};

export const routeRequest = createRouter(routes, { response });
