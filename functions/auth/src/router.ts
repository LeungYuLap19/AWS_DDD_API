import { createRouter } from '@aws-ddd-api/shared';
import type { RouteHandler } from '../../../types/lambda';
import { response } from './utils/response';
import { handleProxyAny, handleProxyRoot } from './services/auth';

const routes: Record<string, RouteHandler> = {
  '/auth': handleProxyRoot,
  '/auth/{proxy+}': handleProxyAny,
};

export const routeRequest = createRouter(routes, { response });
