import { createRouter } from '@aws-ddd-api/shared/http/router';
import { response } from './utils/response';

const routes = {
  'GET /pet/recovery/lost': () => import('./services/petLost').then(m => m.handleListPetLost),
  'POST /pet/recovery/lost': () => import('./services/petLost').then(m => m.handleCreatePetLost),
  'DELETE /pet/recovery/lost/{petLostID}': () => import('./services/petLost').then(m => m.handleDeletePetLost),
  'GET /pet/recovery/found': () => import('./services/petFound').then(m => m.handleListPetFound),
  'POST /pet/recovery/found': () => import('./services/petFound').then(m => m.handleCreatePetFound),
  'DELETE /pet/recovery/found/{petFoundID}': () => import('./services/petFound').then(m => m.handleDeletePetFound),
};

export const routeRequest = createRouter(routes, { response });
