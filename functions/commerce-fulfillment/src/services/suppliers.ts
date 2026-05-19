import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { requireRole } from '@aws-ddd-api/shared/auth/context';
import { parsePathParam, tempIdString } from '@aws-ddd-api/shared/validation/common';
import { parseBody } from '@aws-ddd-api/shared/validation/zod';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { response } from '../utils/response';
import { sanitizeOrderVerification } from '../utils/sanitize';
import { normalizeEmail, normalizePhone } from '../utils/normalize';
import { supplierUpdateSchema } from '../zodSchema/orderVerificationSchema';
import {
  loadAuthorizedSupplierOrderVerification,
} from '../utils/selfAccess';

const ORDER_VERIFICATION_READ_PROJECTION = [
  '_id', 'tagId', 'staffVerification', 'contact', 'verifyDate', 'tagCreationDate',
  'petName', 'shortUrl', 'masterEmail', 'qrUrl', 'petUrl', 'orderId', 'location',
  'petHuman', 'createdAt', 'updatedAt', 'pendingStatus', 'option', 'type',
  'optionSize', 'optionColor', 'price', 'cancelled',
].join(' ');

type RawDocument = Record<string, unknown>;

/**
 * GET /commerce/fulfillment/suppliers/{orderId}
 * Admin-only — returns supplier-facing verification/edit view.
 * Extracts orderId from named path parameter.
 * Legacy: GET /v2/orderVerification/supplier/{orderId} (OrderVerification)
 */
export async function handleGetSupplierVerification(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  requireRole(ctx.event, ['admin']);

  const orderParam = parsePathParam(ctx.event.pathParameters?.orderId, tempIdString());
  if (!orderParam.ok) {
    return response.errorResponse(orderParam.statusCode, orderParam.errorKey, ctx.event);
  }
  const orderId = orderParam.data;

  await connectToMongoDB();
  const OrderVerification = mongoose.model('OrderVerification') as mongoose.Model<RawDocument>;
  const Order = mongoose.model('Order') as mongoose.Model<RawDocument>;

  const authorization = await loadAuthorizedSupplierOrderVerification(
    ctx.event,
    OrderVerification,
    Order,
    orderId,
    ORDER_VERIFICATION_READ_PROJECTION
  );

  const orderVerify = authorization.orderVerification;
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
    createdAt: safeEntity.createdAt,
    updatedAt: safeEntity.updatedAt,
    pendingStatus: safeEntity.pendingStatus,
    option: safeEntity.option,
    optionSize: safeEntity.optionSize,
    optionColor: safeEntity.optionColor,
  };

  return response.successResponse(200, ctx.event, {
    message: 'success.retrieved',
    data: { id: safeEntity._id, ...form },
  });
}

/**
 * PATCH /commerce/fulfillment/suppliers/{orderId}
 * Admin-only — updates supplier-editable verification fields.
 * Accepts JSON body only (legacy accepted multipart; DDD tightens to JSON).
 * Extracts orderId from named path parameter.
 * Legacy: PUT /v2/orderVerification/supplier/{orderId} (OrderVerification)
 */
export async function handlePatchSupplierVerification(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  requireRole(ctx.event, ['admin']);

  const orderParam = parsePathParam(ctx.event.pathParameters?.orderId, tempIdString());
  if (!orderParam.ok) {
    return response.errorResponse(orderParam.statusCode, orderParam.errorKey, ctx.event);
  }
  const orderId = orderParam.data;

  const parsed = parseBody(ctx.body, supplierUpdateSchema);
  if (!parsed.ok) {
    return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
  }

  await connectToMongoDB();
  const OrderVerification = mongoose.model('OrderVerification') as mongoose.Model<RawDocument>;
  const Order = mongoose.model('Order') as mongoose.Model<RawDocument>;

  const authorization = await loadAuthorizedSupplierOrderVerification(
    ctx.event,
    OrderVerification,
    Order,
    orderId,
    '_id orderId masterEmail'
  );

  const existingOrderVerification = authorization.orderVerification;
  if (!existingOrderVerification) {
    return response.errorResponse(404, 'fulfillment.errors.notFound', ctx.event);
  }

  const payload = parsed.data;

  const setFields: Record<string, unknown> = {};
  if (payload.contact) setFields['contact'] = normalizePhone(payload.contact);
  if (payload.petName) setFields['petName'] = payload.petName;
  if (payload.shortUrl) setFields['shortUrl'] = payload.shortUrl;
  if (payload.masterEmail) setFields['masterEmail'] = normalizeEmail(payload.masterEmail);
  if (payload.location) setFields['location'] = payload.location;
  if (payload.petHuman) setFields['petHuman'] = payload.petHuman;
  if (payload.pendingStatus !== undefined) setFields['pendingStatus'] = payload.pendingStatus;
  if (payload.qrUrl) setFields['qrUrl'] = payload.qrUrl;
  if (payload.petUrl) setFields['petUrl'] = payload.petUrl;

  if (Object.keys(setFields).length === 0 && !payload.petContact) {
    return response.errorResponse(400, 'common.noFieldsToUpdate', ctx.event);
  }

  if (payload.petContact && existingOrderVerification.orderId) {
    await Order.updateOne(
      { tempId: existingOrderVerification.orderId },
      { $set: { petContact: normalizePhone(payload.petContact) } }
    );
  }

  if (Object.keys(setFields).length > 0) {
    const updateResult = await OrderVerification.updateOne(
      { _id: existingOrderVerification._id },
      { $set: setFields }
    ) as { matchedCount: number };

    if (updateResult.matchedCount === 0) {
      return response.errorResponse(404, 'fulfillment.errors.notFound', ctx.event);
    }
  }

  return response.successResponse(200, ctx.event, {
    message: 'success.updated',
  });
}
