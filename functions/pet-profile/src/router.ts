import { createRouter } from '@aws-ddd-api/shared';
import type { RouteHandler } from '../../../types/lambda';
import { handleCreatePetProfile } from './services/createProfile';
import { handleDeletePetProfile } from './services/deleteProfile';
import { handleGetMyPetProfiles, handleGetPetProfile, handleGetPetProfileByTag } from './services/getProfile';
import { handlePatchPetProfile } from './services/patchProfile';
import { response } from './utils/response';

const routes: Record<string, RouteHandler> = {
  'POST /pet/profile': handleCreatePetProfile,
  'GET /pet/profile/me': handleGetMyPetProfiles,
  'GET /pet/profile/by-tag/{tagId}': handleGetPetProfileByTag,
  'GET /pet/profile/{petId}': handleGetPetProfile,
  'PATCH /pet/profile/{petId}': handlePatchPetProfile,
  'DELETE /pet/profile/{petId}': handleDeletePetProfile,
};

export const routeRequest = createRouter(routes, { response });
