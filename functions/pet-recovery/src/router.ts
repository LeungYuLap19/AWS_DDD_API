import { createRouter } from '@aws-ddd-api/shared';
import type { RouteHandler } from '../../../types/lambda';
import { response } from './utils/response';
import { handleProxyAny, handleProxyRoot } from './services/recovery';

const routes: Record<string, RouteHandler> = {
  '/pet/recovery': handleProxyRoot,
  '/pet/recovery/{proxy+}': handleProxyAny,
};

export const routeRequest = createRouter(routes, { response });
