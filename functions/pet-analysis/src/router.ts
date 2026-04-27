import { createRouter } from '@aws-ddd-api/shared';
import type { RouteHandler } from '../../../types/lambda';
import { response } from './utils/response';
import { handleProxyAny, handleProxyRoot } from './services/analysis';

const routes: Record<string, RouteHandler> = {
  '/pet/analysis': handleProxyRoot,
  '/pet/analysis/{proxy+}': handleProxyAny,
};

export const routeRequest = createRouter(routes, { response });
