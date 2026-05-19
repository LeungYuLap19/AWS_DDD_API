import { createRouter } from '@aws-ddd-api/shared/http/router';
import { response } from './utils/response';

const routes = {
  'GET /user/me': () => import('./services/getMe').then(m => m.handleGetMe),
  'PATCH /user/me': () => import('./services/patchMe').then(m => m.handlePatchMe),
  'DELETE /user/me': () => import('./services/deleteMe').then(m => m.handleDeleteMe),
};

export const routeRequest = createRouter(routes, { response });
