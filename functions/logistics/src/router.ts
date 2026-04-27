import { createRouter } from '@aws-ddd-api/shared';
import type { RouteHandler } from '../../../types/lambda';
import { response } from './utils/response';
import { handleProxyAny, handleProxyRoot } from './services/logistics';

const routes: Record<string, RouteHandler> = {
  '/logistics': handleProxyRoot,
  '/logistics/{proxy+}': handleProxyAny,
};

export const routeRequest = createRouter(routes, { response });
