import { createRouter } from '@aws-ddd-api/shared/http/router';
import { response } from './utils/response';

const routes = {
  'GET /pet/reference/breed/{animalType}': () => import('./services/breed').then((m) => m.handleGetBreedReference),
  'GET /pet/reference/deworm': () => import('./services/deworm').then((m) => m.handleGetDewormReference),
};

export const routeRequest = createRouter(routes, { response });
