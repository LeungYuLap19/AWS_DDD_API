import { createRouter } from '@aws-ddd-api/shared';
import { response } from './utils/response';

const routes = {
  'GET /pet/biometric/{petId}': () => import('./services/biometric').then(m => m.handleGetBiometric),
  'DELETE /pet/biometric/{petId}': () => import('./services/biometric').then(m => m.handleDeleteBiometric),
  'POST /pet/biometric/{petId}/registrations': () => import('./services/biometric').then(m => m.handleRegisterBiometric),
  'POST /pet/biometric/{petId}/verifications': () => import('./services/biometric').then(m => m.handleVerifyBiometric),
};

export const routeRequest = createRouter(routes, { response });
