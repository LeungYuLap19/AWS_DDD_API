import { createRouter } from '@aws-ddd-api/shared';
import type { RouteHandler } from '../../../types/lambda';
import { response } from './utils/response';
import { handleGetVerificationList } from './services/verifications';
import { handleCancelOrderVerification } from './services/cancel';
import { handleGetTagVerification, handlePatchTagVerification } from './services/tags';
import { handleGetSupplierVerification, handlePatchSupplierVerification } from './services/suppliers';
import { handleGetWhatsAppOrderLink } from './services/shareLinks';
import { handleSendPtagDetectionEmail } from './services/commands';

const routes: Record<string, RouteHandler> = {
  'GET /commerce/fulfillment': handleGetVerificationList,
  'DELETE /commerce/fulfillment/{orderVerificationId}': handleCancelOrderVerification,
  'GET /commerce/fulfillment/tags/{tagId}': handleGetTagVerification,
  'PATCH /commerce/fulfillment/tags/{tagId}': handlePatchTagVerification,
  'GET /commerce/fulfillment/suppliers/{orderId}': handleGetSupplierVerification,
  'PATCH /commerce/fulfillment/suppliers/{orderId}': handlePatchSupplierVerification,
  'GET /commerce/fulfillment/share-links/whatsapp/{verificationId}': handleGetWhatsAppOrderLink,
  'POST /commerce/commands/ptag-detection-email': handleSendPtagDetectionEmail,
};

export const routeRequest = createRouter(routes, { response });
