import { createRouter } from '@aws-ddd-api/shared';
import { response } from './utils/response';

const routes = {
  'GET /pet/adoption': () => import('./services/adoption').then(m => m.handleGetAdoptionList),
  'GET /pet/adoption/detail/{adoptionId}': () => import('./services/adoption').then(m => m.handleGetBrowseById),
  'GET /pet/adoption/{petId}': () => import('./services/adoption').then(m => m.handleGetManaged),
  'POST /pet/adoption/{petId}': () => import('./services/adoption').then(m => m.handleCreate),
  'PATCH /pet/adoption/{petId}': () => import('./services/adoption').then(m => m.handleUpdate),
  'DELETE /pet/adoption/{petId}': () => import('./services/adoption').then(m => m.handleDelete),
};

export const routeRequest = createRouter(routes, { response });
