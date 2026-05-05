import { createRouter } from '@aws-ddd-api/shared';
import type { RouteHandler } from '../../../types/lambda';
import { response } from './utils/response';
import { handleGetEye, handlePatchEye, handlePostEye } from './services/eye';
import { handleBreedAnalysis } from './services/breed';
import { handleUploadImage, handleUploadPetBreedImage } from './services/upload';

const routes: Record<string, RouteHandler> = {
  'GET /pet/analysis/eye/{identifier}': handleGetEye,
  'POST /pet/analysis/eye/{identifier}': handlePostEye,
  'PATCH /pet/analysis/eye/{identifier}': handlePatchEye,
  'POST /pet/analysis/breed': handleBreedAnalysis,
  'POST /pet/analysis/uploads/image': handleUploadImage,
  'POST /pet/analysis/uploads/breed-image': handleUploadPetBreedImage,
};

export const routeRequest = createRouter(routes, { response });
