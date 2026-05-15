import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { response } from '../utils/response';
import { applyRateLimit } from '../utils/rateLimit';

/**
 * Returns the curated deworm reference list as `_id` + `brandName`.
 */
export async function handleGetDewormReference(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  await connectToMongoDB();

  const rateLimitResponse = await applyRateLimit({
    action: 'petReference.deworm',
    event: ctx.event,
    policies: [{ scope: 'ip', limit: 60, windowSeconds: 60 }],
  });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const Anthelmintic = mongoose.model('Anthelmintic');
  const list = (await Anthelmintic.find({}).select('brandName').lean()) as Array<{
    _id: unknown;
    brandName?: string | null;
  }>;

  return response.successResponse(200, ctx.event, {
    message: 'success.retrieved',
    data: list.map((doc) => ({
      _id: String(doc._id),
      brandName: doc.brandName ?? null,
    })),
  });
}
