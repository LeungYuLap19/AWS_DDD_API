import { createRouter } from '@aws-ddd-api/shared';
import { response } from './utils/response';

const routes = {
  'GET /pet/source/{petId}': () => import('./services/source').then(m => m.handleGetPetSource),
  'POST /pet/source/{petId}': () => import('./services/source').then(m => m.handleCreatePetSource),
  'PATCH /pet/source/{petId}': () => import('./services/source').then(m => m.handlePatchPetSource),
};

export const routeRequest = createRouter(routes, { response });
