import { createRouter } from '@aws-ddd-api/shared';
import type { RouteHandler } from '../../../types/lambda';
import { response } from './utils/response';
import { handleProxyAny, handleProxyRoot } from './services/profile';

const routes: Record<string, RouteHandler> = {
  '/pet/profile': handleProxyRoot,
  '/pet/profile/{proxy+}': handleProxyAny,
};

export const routeRequest = createRouter(routes, { response });
