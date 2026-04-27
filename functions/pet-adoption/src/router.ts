import { createRouter } from '@aws-ddd-api/shared';
import type { RouteHandler } from '../../../types/lambda';
import { response } from './utils/response';
import { handleProxyAny, handleProxyRoot } from './services/adoption';

const routes: Record<string, RouteHandler> = {
  '/pet/adoption': handleProxyRoot,
  '/pet/adoption/{proxy+}': handleProxyAny,
};

export const routeRequest = createRouter(routes, { response });
