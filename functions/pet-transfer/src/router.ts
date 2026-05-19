import { createRouter } from '@aws-ddd-api/shared/http/router';
import { response } from './utils/response';

const routes = {
  'POST /pet/transfer/{petId}': () => import('./services/transfer').then(m => m.handleCreateTransfer),
  'PATCH /pet/transfer/{petId}/{transferId}': () => import('./services/transfer').then(m => m.handleUpdateTransfer),
  'DELETE /pet/transfer/{petId}/{transferId}': () => import('./services/transfer').then(m => m.handleDeleteTransfer),
  'POST /pet/transfer/{petId}/ngo-reassignment': () => import('./services/transfer').then(m => m.handleNGOTransfer),
};

export const routeRequest = createRouter(routes, { response });
