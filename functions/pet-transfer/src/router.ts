import { createRouter } from '@aws-ddd-api/shared';
import type { RouteHandler } from '../../../types/lambda';
import { response } from './utils/response';
import { handleProxyAny, handleProxyRoot } from './services/transfer';

const routes: Record<string, RouteHandler> = {
  '/pet/transfer': handleProxyRoot,
  '/pet/transfer/{proxy+}': handleProxyAny,
};

export const routeRequest = createRouter(routes, { response });
