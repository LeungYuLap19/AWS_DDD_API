import { createRouter } from '@aws-ddd-api/shared';
import { response } from './utils/response';

const routes = {
  '/pet/biometric': () => import('./services/biometric').then(m => m.handleProxyRoot),
  '/pet/biometric/{proxy+}': () => import('./services/biometric').then(m => m.handleProxyAny),
};

export const routeRequest = createRouter(routes, { response });
