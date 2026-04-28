import { createRouter } from '@aws-ddd-api/shared';
import type { RouteHandler } from '../../../types/lambda';
import { response } from './utils/response';
import {
  handleCreateChallenge,
  handleCreateNgoRegistration,
  handleCreateUserRegistration,
  handleRefreshToken,
  handleVerifyChallenge,
} from './services/auth';

const routes: Record<string, RouteHandler> = {
  'POST /auth/challenges': handleCreateChallenge,
  'POST /auth/challenges/verify': handleVerifyChallenge,
  'POST /auth/registrations/user': handleCreateUserRegistration,
  'POST /auth/registrations/ngo': handleCreateNgoRegistration,
  'POST /auth/tokens/refresh': handleRefreshToken,
};

export const routeRequest = createRouter(routes, { response });
