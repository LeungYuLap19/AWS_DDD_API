import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { requireRole } from '@aws-ddd-api/shared/auth/context';
import { paginationQuerySchema } from '@aws-ddd-api/shared/validation/common';
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
 * Admin-only — returns paginated list of order verifications.
 * Legacy: GET /purchase/order-verification (purchaseConfirmation)
 */
export async function handleGetVerificationList(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  requireRole(ctx.event, ['admin']);

  const pagination = paginationQuerySchema().safeParse(ctx.event.queryStringParameters ?? {});
  if (!pagination.success) {
    return response.errorResponse(400, 'common.invalidQueryParams', ctx.event);
  }
  const { page, limit } = pagination.data;
  const skip = (page - 1) * limit;

  await connectToMongoDB();
  const OrderVerification = mongoose.model('OrderVerification');

  const [records, total] = await Promise.all([
    OrderVerification.find({}, LIST_PROJECTION).skip(skip).limit(limit).lean(),
    OrderVerification.countDocuments({}),
  ]);

  return response.successResponse(200, ctx.event, {
    message: 'success.retrieved',
    data: (records as Record<string, unknown>[]).map(sanitizeOrderVerification),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}
