import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { requireAuthContext, parseBody } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { response } from '../utils/response';
import { sanitizeOrderVerification } from '../utils/sanitize';
import { normalizeEmail, normalizePhone, parseDDMMYYYY } from '../utils/normalize';
import { tagUpdateSchema } from '../zodSchema/orderVerificationSchema';

const ORDER_VERIFICATION_READ_PROJECTION = [
  '_id', 'tagId', 'staffVerification', 'contact', 'verifyDate', 'tagCreationDate',
  'petName', 'shortUrl', 'masterEmail', 'qrUrl', 'petUrl', 'orderId', 'location',
  'petHuman', 'createdAt', 'updatedAt', 'pendingStatus', 'option', 'type',
  'optionSize', 'optionColor', 'price', 'cancelled',
].join(' ');

const ORDER_READ_PROJECTION = [
  '_id', 'tempId', 'lastName', 'email', 'phoneNumber', 'petContact',
  'sfWayBillNumber', 'language',
].join(' ');

type RawDocument = Record<string, unknown>;

function buildDeliveryText(verifyDate: unknown, language: unknown): string {
  let estStart: Date;
  let estEnd: Date;

  if (verifyDate) {
    const verifyDt = new Date(verifyDate as string | Date);
    estStart = new Date(verifyDt);
    estStart.setDate(verifyDt.getDate() + 2);
    estEnd = new Date(verifyDt);
    estEnd.setDate(verifyDt.getDate() + 4);
  } else {
    estStart = new Date();
    estStart.setDate(estStart.getDate() + 3);
    estEnd = new Date();
    estEnd.setDate(estEnd.getDate() + 5);
  }

  if (language === 'chn') {
    const startMonth = estStart.getMonth() + 1;
    const startDay = estStart.getDate();
    const endDay = estEnd.getDate();

    if (estStart.getMonth() !== estEnd.getMonth()) {
      const endMonth = estEnd.getMonth() + 1;
      return `${startMonth} 月 ${startDay} 日至 ${endMonth} 月 ${endDay} 日`;
    }

    return `${startMonth} 月 ${startDay} 日至 ${endDay} 日`;
  }

  const startMonthStr = estStart.toLocaleDateString('en-US', { month: 'short' });
  const startDay = estStart.getDate();
  const endMonthStr = estEnd.toLocaleDateString('en-US', { month: 'short' });
  const endDay = estEnd.getDate();

  if (
    estStart.getFullYear() === estEnd.getFullYear() &&
    estStart.getMonth() === estEnd.getMonth()
  ) {
    return `${startMonthStr} ${startDay} - ${endDay}`;
  }

  return `${startMonthStr} ${startDay} - ${endMonthStr} ${endDay}`;
}

async function dispatchWhatsAppTrackingMessage(
  order: RawDocument | null | undefined,
  orderVerification: RawDocument | null | undefined,
  event: RouteContext['event']
): Promise<{ dispatched: boolean; reason?: string }> {
  const token = process.env.WHATSAPP_BEARER_TOKEN;
  if (!token) {
    return { dispatched: false, reason: 'missing-token' };
  }

  if (!order?.phoneNumber || !order?.sfWayBillNumber) {
    return { dispatched: false, reason: 'missing-order-contact' };
  }

  const deliveryText = buildDeliveryText(orderVerification?.verifyDate, order?.language);
  const lang = order?.language === 'chn' ? 'chn' : 'en';
  const templateName = lang === 'chn' ? 'ptag_track_chn' : 'ptag_track_eng';
  const languageCode = lang === 'chn' ? 'zh_CN' : 'en';
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const whatsappNumber = `+852${normalizePhone(order.phoneNumber)}`;

  const headers = {
    'Content-Type': 'application/json',
    Authorization: token,
  };

  const data = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: whatsappNumber,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: order.lastName || '' },
            { type: 'text', text: order.tempId || '' },
            { type: 'text', text: order.sfWayBillNumber || '' },
            { type: 'text', text: deliveryText },
          ],
        },
        {
          type: 'button',
          sub_type: 'url',
          index: 0,
          parameters: [{ type: 'text', text: order.sfWayBillNumber }],
        },
      ],
    },
  };

  const fetchResponse = await fetch(
    `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`,
    { method: 'POST', headers, body: JSON.stringify(data) }
  );

  const text = await fetchResponse.text();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    parsed = { raw: text };
  }

  if (!fetchResponse.ok || parsed?.error) {
    const providerError =
      (parsed?.error as { message?: string })?.message ||
      (parsed?.raw as string) ||
      `HTTP ${fetchResponse.status}`;
    throw new Error(providerError);
  }

  return { dispatched: true };
}

/**
 * GET /commerce/fulfillment/tags/{tagId}
 * Authenticated — returns tag-bound verification record + linked SF waybill.
 * Extracts tagId from named path parameter.
 * Legacy: GET /v2/orderVerification/{tagId} (OrderVerification)
 */
export async function handleGetTagVerification(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  try {
    requireAuthContext(ctx.event);

    const tagId = ctx.event.pathParameters?.tagId ?? '';

    if (!tagId) {
      return response.errorResponse(400, 'fulfillment.errors.missingTagId', ctx.event);
    }

    await connectToMongoDB();
    const OrderVerification = mongoose.model('OrderVerification');
    const Order = mongoose.model('Order');

    const orderVerify = await OrderVerification.findOne({ tagId })
      .select(ORDER_VERIFICATION_READ_PROJECTION)
      .lean() as RawDocument | null;

    if (!orderVerify) {
      return response.errorResponse(404, 'fulfillment.errors.notFound', ctx.event);
    }

    const safeEntity = sanitizeOrderVerification(orderVerify) as RawDocument;
    const linkedOrder = await Order.findOne({ tempId: safeEntity.orderId })
      .select('sfWayBillNumber')
      .lean() as { sfWayBillNumber?: string } | null;

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
    };

    return response.successResponse(200, ctx.event, {
      message: 'Order Verification info retrieved successfully',
      form,
      id: safeEntity._id,
      sf: linkedOrder?.sfWayBillNumber,
    });
  } catch (error) {
    const statusCode = (error as { statusCode?: number })?.statusCode;
    if (statusCode === 401 || statusCode === 403) {
      return response.errorResponse(statusCode, (error as { errorKey?: string })?.errorKey ?? 'common.forbidden', ctx.event);
    }
    return response.errorResponse(500, 'common.internalError', ctx.event);
  }
}

/**
 * PATCH /commerce/fulfillment/tags/{tagId}
 * Authenticated — updates allowed fields on the tag-bound verification record.
 * Attempts WhatsApp tracking dispatch after a successful update.
 * Extracts tagId from named path parameter.
 * Legacy: PUT /v2/orderVerification/{tagId} (OrderVerification)
 */
export async function handlePatchTagVerification(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  try {
    requireAuthContext(ctx.event);

    const tagId = ctx.event.pathParameters?.tagId ?? '';

    if (!tagId) {
      return response.errorResponse(400, 'fulfillment.errors.missingTagId', ctx.event);
    }

    const parsed = parseBody(ctx.body, tagUpdateSchema);
    if (!parsed.ok) {
      return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
    }

    const payload = parsed.data;

    await connectToMongoDB();
    const OrderVerification = mongoose.model('OrderVerification');
    const Order = mongoose.model('Order');

    const existing = await OrderVerification.findOne({ tagId })
      .select('_id orderId')
      .lean() as { _id: unknown; orderId?: string } | null;

    if (!existing) {
      return response.errorResponse(404, 'fulfillment.errors.notFound', ctx.event);
    }

    if (payload.orderId !== undefined && payload.orderId !== existing.orderId) {
      const duplicated = await OrderVerification.findOne({ orderId: payload.orderId })
        .select('_id')
        .lean();
      if (duplicated) {
        return response.errorResponse(409, 'fulfillment.errors.duplicateOrderId', ctx.event);
      }
    }

    const setFields: Record<string, unknown> = {};
    if (payload.contact) setFields['contact'] = normalizePhone(payload.contact);
    if (payload.verifyDate !== undefined) {
      const parsedVerifyDate = parseDDMMYYYY(payload.verifyDate as string);
      if (!parsedVerifyDate) {
        return response.errorResponse(400, 'fulfillment.errors.invalidDate', ctx.event);
      }
      setFields['verifyDate'] = parsedVerifyDate;
    }
    if (payload.petName) setFields['petName'] = payload.petName;
    if (payload.shortUrl) setFields['shortUrl'] = payload.shortUrl;
    if (payload.masterEmail) setFields['masterEmail'] = normalizeEmail(payload.masterEmail);
    if (payload.orderId !== undefined) setFields['orderId'] = payload.orderId;
    if (payload.location) setFields['location'] = payload.location;
    if (payload.petHuman) setFields['petHuman'] = payload.petHuman;

    if (Object.keys(setFields).length === 0) {
      return response.errorResponse(400, 'common.missingParams', ctx.event);
    }

    await OrderVerification.updateOne({ tagId }, { $set: setFields });

    const updatedVerification = await OrderVerification.findOne({ tagId })
      .select(ORDER_VERIFICATION_READ_PROJECTION)
      .lean() as RawDocument | null;
    const linkedOrder = await Order.findOne({ tempId: updatedVerification?.orderId })
      .select(ORDER_READ_PROJECTION)
      .lean() as RawDocument | null;

    let notificationDispatched = false;
    try {
      const notificationResult = await dispatchWhatsAppTrackingMessage(
        linkedOrder,
        updatedVerification,
        ctx.event
      );
      notificationDispatched = notificationResult?.dispatched === true;
    } catch {
      // non-fatal — response already succeeded
    }

    return response.successResponse(200, ctx.event, {
      message: 'Tag info updated successfully',
      id: existing._id,
      notificationDispatched,
    });
  } catch (error) {
    const statusCode = (error as { statusCode?: number })?.statusCode;
    if (statusCode === 401 || statusCode === 403) {
      return response.errorResponse(statusCode, (error as { errorKey?: string })?.errorKey ?? 'common.forbidden', ctx.event);
    }
    return response.errorResponse(500, 'common.internalError', ctx.event);
  }
}
