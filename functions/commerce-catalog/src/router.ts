import { createRouter } from '@aws-ddd-api/shared';
import { response } from './utils/response';

const routes = {
  'GET /commerce/catalog': () => import('./services/catalog').then(m => m.handleGetCatalog),
  'POST /commerce/catalog/events': () => import('./services/catalog').then(m => m.handleCreateCatalogEvent),
  'GET /commerce/storefront': () => import('./services/storefront').then(m => m.handleGetStorefront),
  'POST /commerce/storefront/shop-code-verifications': () => import('./services/storefront').then(m => m.handlePostStorefrontShopCodeVerification),
};

export const routeRequest = createRouter(routes, { response });
