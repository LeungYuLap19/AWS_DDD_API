import { createRouter } from '@aws-ddd-api/shared/http/router';
import { response } from './utils/response';

const routes = {
  'POST /pet/profile': () => import('./services/createProfile').then(m => m.handleCreatePetProfile),
  'GET /pet/profile/me': () => import('./services/getProfile').then(m => m.handleGetMyPetProfiles),
  'GET /pet/profile/by-tag/{tagId}': () => import('./services/getProfile').then(m => m.handleGetPetProfileByTag),
  'GET /pet/profile/{petId}': () => import('./services/getProfile').then(m => m.handleGetPetProfile),
  'PATCH /pet/profile/{petId}': () => import('./services/patchProfile').then(m => m.handlePatchPetProfile),
  'DELETE /pet/profile/{petId}': () => import('./services/deleteProfile').then(m => m.handleDeletePetProfile),
};

export const routeRequest = createRouter(routes, { response });
