import { createRouter } from '@aws-ddd-api/shared';
import type { RouteHandler } from '../../../types/lambda';
import { response } from './utils/response';
import {
  handleGetAdoptionList,
  handleGetById,
  handleCreate,
  handleUpdate,
  handleDelete,
} from './services/adoption';

const routes: Record<string, RouteHandler> = {
  'GET /pet/adoption': handleGetAdoptionList,
  'GET /pet/adoption/{id}': handleGetById,
  'POST /pet/adoption/{id}': handleCreate,
  'PATCH /pet/adoption/{id}': handleUpdate,
  'DELETE /pet/adoption/{id}': handleDelete,
};

export const routeRequest = createRouter(routes, { response });
