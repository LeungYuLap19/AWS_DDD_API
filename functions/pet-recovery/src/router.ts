import { createRouter } from '@aws-ddd-api/shared';
import type { RouteHandler } from '../../../types/lambda';
import { response } from './utils/response';
import {
  handleListPetLost,
  handleCreatePetLost,
  handleDeletePetLost,
} from './services/petLost';
import {
  handleListPetFound,
  handleCreatePetFound,
  handleDeletePetFound,
} from './services/petFound';

const routes: Record<string, RouteHandler> = {
  'GET /pet/recovery/lost': handleListPetLost,
  'POST /pet/recovery/lost': handleCreatePetLost,
  'DELETE /pet/recovery/lost/{petLostID}': handleDeletePetLost,
  'GET /pet/recovery/found': handleListPetFound,
  'POST /pet/recovery/found': handleCreatePetFound,
  'DELETE /pet/recovery/found/{petFoundID}': handleDeletePetFound,
};

export const routeRequest = createRouter(routes, { response });
