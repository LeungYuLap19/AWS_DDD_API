import { createRouter } from '@aws-ddd-api/shared';
import type { RouteHandler } from '../../../types/lambda';
import { response } from './utils/response';
import { handleProxyAny, handleProxyRoot } from './services/source';

const routes: Record<string, RouteHandler> = {
  '/pet/source': handleProxyRoot,
  '/pet/source/{proxy+}': handleProxyAny,
};

export const routeRequest = createRouter(routes, { response });
