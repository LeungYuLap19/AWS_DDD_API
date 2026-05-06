import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { requireRole } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { response } from '../utils/response';
import { sanitizeOrderVerification } from '../utils/sanitize';

const LIST_PROJECTION = {
  tagId: 1,
  staffVerification: 1,
  cancelled: 1,
  verifyDate: 1,
  petName: 1,
  shortUrl: 1,
  masterEmail: 1,
  qrUrl: 1,
  petUrl: 1,
  orderId: 1,
  pendingStatus: 1,
  option: 1,
  type: 1,
  optionSize: 1,
  optionColor: 1,
  price: 1,
  discountProof: 1,
  createdAt: 1,
  updatedAt: 1,
};

/**
 * GET /commerce/fulfillment
 * Admin/developer-only — returns paginated list of order verifications.
 * Legacy: GET /purchase/order-verification (purchaseConfirmation)
 */
export async function handleGetVerificationList(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  try {
    requireRole(ctx.event, ['admin', 'developer']);

    const queryParams = ctx.event.queryStringParameters || {};
    const page = Math.max(1, parseInt(queryParams['page'] ?? '1', 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(queryParams['limit'] ?? '100', 10) || 100));
    const skip = (page - 1) * limit;

    await connectToMongoDB();
    const OrderVerification = mongoose.model('OrderVerification');

    const [records, total] = await Promise.all([
      OrderVerification.find({}, LIST_PROJECTION).skip(skip).limit(limit).lean(),
      OrderVerification.countDocuments({}),
    ]);

    return response.successResponse(200, ctx.event, {
      orderVerification: (records as Record<string, unknown>[]).map(sanitizeOrderVerification),
      pagination: { page, limit, total },
    });
  } catch (error) {
    const statusCode = (error as { statusCode?: number })?.statusCode;
    if (statusCode === 401 || statusCode === 403) {
      return response.errorResponse(statusCode, (error as { errorKey?: string })?.errorKey ?? 'common.forbidden', ctx.event);
    }
    return response.errorResponse(500, 'common.internalError', ctx.event);
  }
}
