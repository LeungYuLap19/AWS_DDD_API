import { createRouter } from '@aws-ddd-api/shared/http/router';
import { response } from './utils/response';

const routes = {
  'POST /auth/challenges': () => import('./services/challenge').then(m => m.handleCreateChallenge),
  'POST /auth/challenges/verify': () => import('./services/challenge').then(m => m.handleVerifyChallenge),
  'POST /auth/login/ngo': () => import('./services/login').then(m => m.handleNgoLogin),
  'POST /auth/registrations/user': () => import('./services/registration').then(m => m.handleUserRegistration),
  'POST /auth/registrations/ngo': () => import('./services/registration').then(m => m.handleNgoRegistration),
  'POST /auth/tokens/refresh': () => import('./services/refresh').then(m => m.handleRefreshToken),
};

export const routeRequest = createRouter(routes, { response });
