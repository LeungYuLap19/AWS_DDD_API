import { createRouter } from '@aws-ddd-api/shared';
import type { RouteHandler } from '../../../types/lambda';
import { response } from './utils/response';
import { handleGetCatalog, handleCreateCatalogEvent } from './services/catalog';
import { handleGetStorefront } from './services/storefront';

const routes: Record<string, RouteHandler> = {
  'GET /commerce/catalog': handleGetCatalog,
  'POST /commerce/catalog/events': handleCreateCatalogEvent,
  'GET /commerce/storefront': handleGetStorefront,
};

export const routeRequest = createRouter(routes, { response });
