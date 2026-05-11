import { createRouter } from '@aws-ddd-api/shared';
import { response } from './utils/response';

const routes = {
  'GET /pet/analysis/eye/disease/{eyeDiseaseName}': () => import('./services/eye').then(m => m.handleGetEyeDisease),
  'GET /pet/analysis/eye/{petId}': () => import('./services/eye').then(m => m.handleGetEye),
  'POST /pet/analysis/eye/{petId}': () => import('./services/eye').then(m => m.handlePostEye),
  'PATCH /pet/analysis/eye/{petId}': () => import('./services/eye').then(m => m.handlePatchEye),
  'POST /pet/analysis/breed': () => import('./services/breed').then(m => m.handleBreedAnalysis),
  'POST /pet/analysis/uploads/image': () => import('./services/upload').then(m => m.handleUploadImage),
  'POST /pet/analysis/uploads/breed-image': () => import('./services/upload').then(m => m.handleUploadPetBreedImage),
};

export const routeRequest = createRouter(routes, { response });
