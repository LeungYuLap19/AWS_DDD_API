import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { applyRateLimit } from '../utils/rateLimit';
import { response } from '../utils/response';
import { sanitizeOrderVerification } from '../utils/sanitize';
import { isValidObjectId } from '../utils/normalize';

const ORDER_VERIFICATION_READ_PROJECTION = [
  '_id', 'tagId', 'staffVerification', 'contact', 'verifyDate', 'tagCreationDate',
  'petName', 'shortUrl', 'masterEmail', 'qrUrl', 'petUrl', 'orderId', 'location',
  'petHuman', 'createdAt', 'updatedAt', 'pendingStatus', 'option', 'type',
  'optionSize', 'optionColor', 'price', 'cancelled',
].join(' ');

type RawDocument = Record<string, unknown>;

/**
 * GET /commerce/fulfillment/share-links/whatsapp/{_id}
 * Admin-only — returns order verification payload for the WhatsApp deep-link flow.
 * Extracts verificationId from named path parameter.
 * Legacy: GET /v2/orderVerification/whatsapp-order-link/{_id} (OrderVerification)
 */
export async function handleGetWhatsAppOrderLink(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const verificationId = ctx.event.pathParameters?.verificationId ?? '';

  if (!verificationId) {
    return response.errorResponse(400, 'common.missingPathParams', ctx.event);
  }

  if (!isValidObjectId(verificationId)) {
    return response.errorResponse(400, 'common.invalidObjectId', ctx.event);
  }

  await connectToMongoDB();

  const rateLimitResponse = await applyRateLimit({
    action: 'commerce.fulfillment.shareLinks.whatsapp',
    event: ctx.event,
    policies: [
      { scope: 'ip', limit: 60, windowSeconds: 300 },
    ],
  });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const OrderVerification = mongoose.model('OrderVerification');

  const orderVerify = await OrderVerification.findOne({ _id: verificationId })
    .select(ORDER_VERIFICATION_READ_PROJECTION)
    .lean() as RawDocument | null;

  if (!orderVerify) {
    return response.errorResponse(404, 'fulfillment.errors.notFound', ctx.event);
  }

  const safeEntity = sanitizeOrderVerification(orderVerify) as RawDocument;
  const form = {
    tagId: safeEntity.tagId,
    staffVerification: safeEntity.staffVerification,
    contact: safeEntity.contact,
    verifyDate: safeEntity.verifyDate,
    tagCreationDate: safeEntity.tagCreationDate,
    petName: safeEntity.petName,
    shortUrl: safeEntity.shortUrl,
    masterEmail: safeEntity.masterEmail,
    qrUrl: safeEntity.qrUrl,
    petUrl: safeEntity.petUrl,
    orderId: safeEntity.orderId,
    location: safeEntity.location,
    petHuman: safeEntity.petHuman,
    pendingStatus: safeEntity.pendingStatus,
    option: safeEntity.option,
    price: safeEntity.price,
    type: safeEntity.type,
    optionSize: safeEntity.optionSize,
    optionColor: safeEntity.optionColor,
    createdAt: safeEntity.createdAt,
    updatedAt: safeEntity.updatedAt,
  };

  return response.successResponse(200, ctx.event, {
    message: 'success.retrieved',
    data: { id: safeEntity._id, ...form },
  });
}
