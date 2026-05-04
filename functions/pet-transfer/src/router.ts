import { createRouter } from '@aws-ddd-api/shared';
import type { RouteHandler } from '../../../types/lambda';
import { response } from './utils/response';
import {
  handleCreateTransfer,
  handleDeleteTransfer,
  handleNGOTransfer,
  handleUpdateTransfer,
} from './services/transfer';

const routes: Record<string, RouteHandler> = {
  'POST /pet/transfer/{petId}': handleCreateTransfer,
  'PATCH /pet/transfer/{petId}/{transferId}': handleUpdateTransfer,
  'DELETE /pet/transfer/{petId}/{transferId}': handleDeleteTransfer,
  'POST /pet/transfer/{petId}/ngo-reassignment': handleNGOTransfer,
};

export const routeRequest = createRouter(routes, { response });
