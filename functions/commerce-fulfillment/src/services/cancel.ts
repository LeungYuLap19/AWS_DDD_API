import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { requireRole } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { response } from '../utils/response';
import { isValidObjectId } from '../utils/normalize';

/**
 * DELETE /commerce/fulfillment/{orderVerificationId}
 * Admin/developer-only — soft-cancels one order verification by _id.
 * Sets cancelled=true; does not hard-delete the document.
 * Legacy: DELETE /purchase/order-verification/{orderVerificationId} (purchaseConfirmation)
 */
export async function handleCancelOrderVerification(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  try {
    requireRole(ctx.event, ['admin', 'developer']);

    const orderVerificationId = ctx.event.pathParameters?.orderVerificationId ?? '';

    if (!orderVerificationId) {
      return response.errorResponse(400, 'fulfillment.errors.missingVerificationId', ctx.event);
    }

    if (!isValidObjectId(orderVerificationId)) {
      return response.errorResponse(400, 'common.invalidObjectId', ctx.event);
    }

    await connectToMongoDB();
    const OrderVerification = mongoose.model('OrderVerification');

    const existing = await OrderVerification.findOne(
      { _id: orderVerificationId },
      { _id: 1, cancelled: 1 }
    ).lean() as { _id: unknown; cancelled?: boolean } | null;

    if (!existing) {
      return response.errorResponse(404, 'fulfillment.errors.notFound', ctx.event);
    }

    if (existing.cancelled) {
      return response.errorResponse(409, 'fulfillment.errors.alreadyCancelled', ctx.event);
    }

    await OrderVerification.updateOne(
      { _id: orderVerificationId },
      { $set: { cancelled: true } }
    );

    return response.successResponse(200, ctx.event, {
      message: 'Cancelled successfully.',
      orderVerificationId,
    });
  } catch (error) {
    const statusCode = (error as { statusCode?: number })?.statusCode;
    if (statusCode === 401 || statusCode === 403) {
      return response.errorResponse(statusCode, (error as { errorKey?: string })?.errorKey ?? 'common.forbidden', ctx.event);
    }
    return response.errorResponse(500, 'common.internalError', ctx.event);
  }
}
