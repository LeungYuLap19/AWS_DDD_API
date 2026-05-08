import { createRouter } from '@aws-ddd-api/shared';
import { response } from './utils/response';

const routes = {
  'GET /pet/adoption': () => import('./services/adoption').then(m => m.handleGetAdoptionList),
  'GET /pet/adoption/{id}': () => import('./services/adoption').then(m => m.handleGetById),
  'POST /pet/adoption/{id}': () => import('./services/adoption').then(m => m.handleCreate),
  'PATCH /pet/adoption/{id}': () => import('./services/adoption').then(m => m.handleUpdate),
  'DELETE /pet/adoption/{id}': () => import('./services/adoption').then(m => m.handleDelete),
};

export const routeRequest = createRouter(routes, { response });
