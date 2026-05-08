import { createRouter } from '@aws-ddd-api/shared';
import { response } from './utils/response';

const routes = {
  'GET /commerce/fulfillment': () => import('./services/verifications').then(m => m.handleGetVerificationList),
  'DELETE /commerce/fulfillment/{orderVerificationId}': () => import('./services/cancel').then(m => m.handleCancelOrderVerification),
  'GET /commerce/fulfillment/tags/{tagId}': () => import('./services/tags').then(m => m.handleGetTagVerification),
  'PATCH /commerce/fulfillment/tags/{tagId}': () => import('./services/tags').then(m => m.handlePatchTagVerification),
  'GET /commerce/fulfillment/suppliers/{orderId}': () => import('./services/suppliers').then(m => m.handleGetSupplierVerification),
  'PATCH /commerce/fulfillment/suppliers/{orderId}': () => import('./services/suppliers').then(m => m.handlePatchSupplierVerification),
  'GET /commerce/fulfillment/share-links/whatsapp/{verificationId}': () => import('./services/shareLinks').then(m => m.handleGetWhatsAppOrderLink),
  'POST /commerce/commands/ptag-detection-email': () => import('./services/commands').then(m => m.handleSendPtagDetectionEmail),
};

export const routeRequest = createRouter(routes, { response });
