import { createRouter } from '@aws-ddd-api/shared';
import type { RouteHandler } from '../../../types/lambda';
import { response } from './utils/response';
import { handleProxyAny, handleProxyRoot } from './services/ngo';

const routes: Record<string, RouteHandler> = {
  '/ngo': handleProxyRoot,
  '/ngo/{proxy+}': handleProxyAny,
};

export const routeRequest = createRouter(routes, { response });
