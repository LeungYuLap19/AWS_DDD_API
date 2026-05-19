import { createRouter } from '@aws-ddd-api/shared/http/router';
import { response } from './utils/response';

const routes = {
  'GET /ngo/me': () => import('./services/ngo').then(m => m.handleGetMe),
  'PATCH /ngo/me': () => import('./services/ngo').then(m => m.handlePatchMe),
  'GET /ngo/me/members': () => import('./services/ngo').then(m => m.handleGetMembers),
};

export const routeRequest = createRouter(routes, { response });
