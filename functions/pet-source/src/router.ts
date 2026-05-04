import { createRouter } from '@aws-ddd-api/shared';
import type { RouteHandler } from '../../../types/lambda';
import { response } from './utils/response';
import {
  handleCreatePetSource,
  handleGetPetSource,
  handlePatchPetSource,
} from './services/source';

const routes: Record<string, RouteHandler> = {
  'GET /pet/source/{petId}': handleGetPetSource,
  'POST /pet/source/{petId}': handleCreatePetSource,
  'PATCH /pet/source/{petId}': handlePatchPetSource,
};

export const routeRequest = createRouter(routes, { response });
