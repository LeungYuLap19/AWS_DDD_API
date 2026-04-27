import { createRouter } from '@aws-ddd-api/shared';
import type { RouteHandler } from '../../../types/lambda';
import { response } from './utils/response';
import { handleProxyAny, handleProxyRoot } from './services/medical';

const routes: Record<string, RouteHandler> = {
  '/pet/medical': handleProxyRoot,
  '/pet/medical/{proxy+}': handleProxyAny,
};

export const routeRequest = createRouter(routes, { response });
