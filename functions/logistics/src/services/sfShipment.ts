import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { getAuthContext, logError, parseBody, requireAuthContext } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { callSfService, getAccessToken } from '../config/sfExpressClient';
import { applyRateLimit } from '../utils/rateLimit';
import { response } from '../utils/response';
import { createShipmentSchema } from '../zodSchema/logisticsSchema';

const PRIVILEGED_ROLES = new Set(['admin', 'ngo', 'staff', 'developer']);

function normalizeEmail(email: string | undefined): string | null {
  return typeof email === 'string' ? email.trim().toLowerCase() : null;
}

export async function createShipment({
  event,
  body,
}: RouteContext): Promise<APIGatewayProxyResult> {
  requireAuthContext(event);
  try {
    await connectToMongoDB();

    const auth = getAuthContext(event);

    const rateLimitResult = await applyRateLimit({
      action: 'logistics.createShipment',
      event,
      identifier: auth?.userEmail ?? auth?.userId ?? null,
      limit: 20,
      windowSeconds: 300,
    });
    if (rateLimitResult) return rateLimitResult;

    const parsed = parseBody(body, createShipmentSchema);
    if (!parsed.ok) return response.errorResponse(parsed.statusCode, parsed.errorKey, event);

    const customerDetails = parsed.data;

    // Ownership check: resolve tempIds against orders and verify caller owns them
    const requestedTempIds = Array.from(
      new Set(
        [
          ...(Array.isArray(customerDetails.tempIdList) ? customerDetails.tempIdList : []),
          ...(customerDetails.tempId ? [customerDetails.tempId] : []),
        ].filter(Boolean)
      )
    );

    let matchedOrders: Array<{ tempId?: string; email: string }> = [];

    if (requestedTempIds.length > 0) {
      const Order = mongoose.model('Order');
      const orders = await Order.find({ tempId: { $in: requestedTempIds } })
        .select('_id tempId email')
        .lean<Array<{ _id: unknown; tempId?: string; email: string }>>();

      if (orders.length > 0) {
        const isPrivileged = auth?.userRole && PRIVILEGED_ROLES.has(auth.userRole);

        if (!isPrivileged) {
          const callerEmail = normalizeEmail(auth?.userEmail);
          if (!callerEmail) {
            logError('Caller email missing for order ownership check', {
              scope: 'services.sfShipment.createShipment',
              extra: { tempIds: requestedTempIds },
            });
            return response.errorResponse(403, 'common.unauthorized', event);
          }

          const unauthorizedOrder = orders.find(
            (order) => normalizeEmail(order.email) !== callerEmail
          );
          if (unauthorizedOrder) {
            logError('Order ownership check failed', {
              scope: 'services.sfShipment.createShipment',
              extra: { tempId: (unauthorizedOrder as { tempId?: string }).tempId },
            });
            return response.errorResponse(403, 'common.unauthorized', event);
          }
        }

        matchedOrders = orders as Array<{ tempId?: string; email: string }>;
      }
    }

    const accessToken = await getAccessToken();
    const apiResultData = await callSfService({
      serviceCode: 'EXP_RECE_CREATE_ORDER',
      accessToken,
      msgData: {
        expressTypeId: 1,
        payMethod: 1,
        isGenEletricPic: 1,
        isReturnRouteLabel: 1,
        cargoDetails: [{ name: 'PTag', count: customerDetails.count || 1 }],
        contactInfoList: [
          {
            contactType: 1,
            contact: 'Pet Pet Club',
            tel: '85255764375',
            country: 'HK',
            province: 'Hong Kong',
            city: 'Tsuen Wan',
            address: 'D3, 29/F, TML Tower, 3 Hoi Shing Road, Tsuen Wan',
          },
          {
            contactType: 2,
            contact: customerDetails.lastName,
            tel: customerDetails.phoneNumber,
            country: 'HK',
            province: 'Hong Kong',
            city: 'Hong Kong',
            address: customerDetails.address,
          },
        ],
        language: 'zh-CN',
        orderId: `T${Math.floor(Math.random() * 1e10)}`,
        custId: process.env.SF_CUSTOMER_CODE,
        extraInfoList: [
          {
            attrName: customerDetails.attrName,
            attrVal: customerDetails.netCode,
          },
        ],
      },
    });

    const waybillInfo = apiResultData.msgData as
      | { waybillNoInfoList?: Array<{ waybillNo?: string }> }
      | undefined;
    const trackingNumber = waybillInfo?.waybillNoInfoList?.[0]?.waybillNo;
    if (!trackingNumber) {
      return response.errorResponse(500, 'logistics.missingWaybill', event);
    }

    const matchedTempIds = matchedOrders.map((o) => o.tempId).filter(Boolean);
    if (matchedTempIds.length > 0) {
      const Order = mongoose.model('Order');
      await Order.updateMany(
        { tempId: { $in: matchedTempIds } },
        { $set: { sfWayBillNumber: trackingNumber } }
      );
    }

    return response.successResponse(200, event, {
      tempIdList: customerDetails.tempIdList,
      trackingNumber,
    });
  } catch (error) {
    logError('Failed to create SF shipment', {
      scope: 'services.sfShipment.createShipment',
      extra: { error },
    });

    const message = (error as { message?: string })?.message ?? '';
    const errorKey = message.startsWith('logistics.') ? message : 'common.internalError';
    return response.errorResponse(500, errorKey, event);
  }
}
