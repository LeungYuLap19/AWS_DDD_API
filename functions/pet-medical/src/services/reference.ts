import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { response } from '../utils/response';
import { applyRateLimit } from '../utils/rateLimit';

/**
 * Public reference list of dewormer brands.
 *
 * - No JWT (API Gateway authorizer is `NONE` on this route)
 * - x-api-key still enforced at the gateway
 * - Per-IP rate limit applied since there is no authenticated identifier
 * - Response projects only `_id` + `brandName`; raw collection documents are
 *   curated and contain no other client-relevant fields, but the projection
 *   guards against accidental field expansion in the source collection.
 */
export async function handleGetDewormReference(
  ctx: RouteContext
): Promise<APIGatewayProxyResult> {
  await connectToMongoDB();

  const rateLimitResponse = await applyRateLimit({
    action: 'petMedical.reference.deworm',
    event: ctx.event,
    policies: [
      { scope: 'ip', limit: 60, windowSeconds: 60 },
      { scope: 'global', limit: 5000, windowSeconds: 60 },
    ],
  });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const Anthelmintic = mongoose.model('Anthelmintic');
  const list = await Anthelmintic.find({}).select('brandName').lean();

  return response.successResponse(200, ctx.event, {
    message: 'success.retrieved',
    data: list.map((doc) => ({
      _id: (doc as { _id: unknown })._id,
      brandName: (doc as { brandName?: string | null }).brandName ?? null,
    })),
  });
}
