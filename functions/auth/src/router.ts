import { createRouter } from '@aws-ddd-api/shared';
import type { RouteHandler } from '../../../types/lambda';
import { response } from './utils/response';
import { handleNgoLogin } from './services/login';
import {
  handleCreateChallenge,
  handleVerifyChallenge,
} from './services/challenge';
import {
  handleNgoRegistration,
  handleUserRegistration,
} from './services/registration';
import { handleRefreshToken } from './services/refresh';

const routes: Record<string, RouteHandler> = {
  'POST /auth/challenges': handleCreateChallenge,
  'POST /auth/challenges/verify': handleVerifyChallenge,
  'POST /auth/login/ngo': handleNgoLogin,
  'POST /auth/registrations/user': handleUserRegistration,
  'POST /auth/registrations/ngo': handleNgoRegistration,
  'POST /auth/tokens/refresh': handleRefreshToken,
};

export const routeRequest = createRouter(routes, { response });
