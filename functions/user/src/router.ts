import { createRouter } from '@aws-ddd-api/shared';
import type { RouteHandler } from '../../../types/lambda';
import { handleDeleteMe, handleGetMe, handlePatchMe } from './services/user';
import { response } from './utils/response';

const routes: Record<string, RouteHandler> = {
  'GET /user/me': handleGetMe,
  'PATCH /user/me': handlePatchMe,
  'DELETE /user/me': handleDeleteMe,
};

export const routeRequest = createRouter(routes, { response });
