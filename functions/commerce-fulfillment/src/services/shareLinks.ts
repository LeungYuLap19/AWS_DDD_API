import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { requireAuthContext } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { response } from '../utils/response';
import { sanitizeOrderVerification } from '../utils/sanitize';
import { normalizeEmail, isValidObjectId } from '../utils/normalize';
import { loadAuthorizedOrderByTempId } from '../utils/selfAccess';
import { getAuthContext } from '@aws-ddd-api/shared';

const ORDER_VERIFICATION_READ_PROJECTION = [
  '_id', 'tagId', 'staffVerification', 'contact', 'verifyDate', 'tagCreationDate',
  'petName', 'shortUrl', 'masterEmail', 'qrUrl', 'petUrl', 'orderId', 'location',
  'petHuman', 'createdAt', 'updatedAt', 'pendingStatus', 'option', 'type',
  'optionSize', 'optionColor', 'price', 'cancelled',
].join(' ');

type RawDocument = Record<string, unknown>;

const PRIVILEGED_ROLES = new Set(['admin', 'developer']);

/**
 * GET /commerce/fulfillment/share-links/whatsapp/{_id}
 * Authenticated + ownership — returns order verification payload for the WhatsApp deep-link flow.
 * Admins see all records; non-admins must own the linked order or match by masterEmail.
 * Extracts verificationId from named path parameter.
 * Legacy: GET /v2/orderVerification/whatsapp-order-link/{_id} (OrderVerification)
 */
export async function handleGetWhatsAppOrderLink(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  try {
    requireAuthContext(ctx.event);

    const verificationId = ctx.event.pathParameters?.verificationId ?? '';

    if (!verificationId) {
      return response.errorResponse(400, 'fulfillment.errors.missingVerificationId', ctx.event);
    }

    if (!isValidObjectId(verificationId)) {
      return response.errorResponse(400, 'fulfillment.errors.invalidVerificationId', ctx.event);
    }

  await connectToMongoDB();
  const OrderVerification = mongoose.model('OrderVerification');
  const Order = mongoose.model('Order') as mongoose.Model<RawDocument>;

  const orderVerify = await OrderVerification.findOne({ _id: verificationId })
    .select(ORDER_VERIFICATION_READ_PROJECTION)
    .lean() as RawDocument | null;

  if (!orderVerify) {
    return response.errorResponse(404, 'fulfillment.errors.notFound', ctx.event);
  }

  const authContext = getAuthContext(ctx.event);
  const userRole = authContext?.userRole;

  if (!userRole || !PRIVILEGED_ROLES.has(userRole)) {
    if (orderVerify.orderId) {
      const orderAuth = await loadAuthorizedOrderByTempId(
        ctx.event,
        Order,
        orderVerify.orderId as string
      );
      if (!orderAuth.isValid) {
        return orderAuth.error!;
      }
      if (!orderAuth.order) {
        const callerEmail = normalizeEmail(authContext?.userEmail);
        const ownerEmail = normalizeEmail(orderVerify.masterEmail as string | undefined);
        if (!callerEmail || !ownerEmail || callerEmail !== ownerEmail) {
          return response.errorResponse(403, 'common.unauthorized', ctx.event);
        }
      }
    } else {
      const callerEmail = normalizeEmail(authContext?.userEmail);
      const ownerEmail = normalizeEmail(orderVerify.masterEmail as string | undefined);
      if (!callerEmail || !ownerEmail || callerEmail !== ownerEmail) {
        return response.errorResponse(403, 'common.unauthorized', ctx.event);
      }
    }
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
      message: 'Order Verification info retrieved successfully',
      form,
      id: safeEntity._id,
    });
  } catch (error) {
    const statusCode = (error as { statusCode?: number })?.statusCode;
    if (statusCode === 401 || statusCode === 403) {
      return response.errorResponse(statusCode, (error as { errorKey?: string })?.errorKey ?? 'common.forbidden', ctx.event);
    }
    return response.errorResponse(500, 'common.internalError', ctx.event);
  }
}
