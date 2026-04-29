import { createRouter } from '@aws-ddd-api/shared';
import type { RouteHandler } from '../../../types/lambda';
import { response } from './utils/response';
import { handleGetMe, handleGetMembers, handlePatchMe } from './services/ngo';

const routes: Record<string, RouteHandler> = {
  'GET /ngo/me': handleGetMe,
  'PATCH /ngo/me': handlePatchMe,
  'GET /ngo/me/members': handleGetMembers,
};

export const routeRequest = createRouter(routes, { response });
