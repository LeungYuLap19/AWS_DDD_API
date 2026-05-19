import { createRouter } from '@aws-ddd-api/shared/http/router';
import { response } from './utils/response';

const routes = {
  'GET /commerce/catalog': () => import('./services/catalog').then(m => m.handleGetCatalog),
  'POST /commerce/catalog/events': () => import('./services/catalog').then(m => m.handleCreateCatalogEvent),
  'GET /commerce/catalog/ptag-products': () => import('./services/ptagProducts').then(m => m.handleGetPtagProducts),
  'GET /commerce/catalog/ptag-products/{productId}': () => import('./services/ptagProducts').then(m => m.handleGetPtagProductById),
  'GET /commerce/storefront': () => import('./services/getStorefront').then(m => m.handleGetStorefront),
  'POST /commerce/storefront/shop-code-verifications': () => import('./services/postStorefrontShopCodeVerification').then(m => m.handlePostStorefrontShopCodeVerification),
};

export const routeRequest = createRouter(routes, { response });
