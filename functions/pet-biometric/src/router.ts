import { createRouter } from '@aws-ddd-api/shared';
import type { RouteHandler } from '../../../types/lambda';
import { response } from './utils/response';
import { handleProxyAny, handleProxyRoot } from './services/biometric';

const routes: Record<string, RouteHandler> = {
  '/pet/biometric': handleProxyRoot,
  '/pet/biometric/{proxy+}': handleProxyAny,
};

export const routeRequest = createRouter(routes, { response });
