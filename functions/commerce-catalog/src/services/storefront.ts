import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { paginationQuerySchema } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { response } from '../utils/response';

export async function handleGetStorefront(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  await connectToMongoDB();

  const pagination = paginationQuerySchema().safeParse(ctx.event.queryStringParameters ?? {});
  if (!pagination.success) {
    return response.errorResponse(400, 'common.invalidQueryParams', ctx.event);
  }
  const { page, limit } = pagination.data;
  const skip = (page - 1) * limit;

  const ShopInfo = mongoose.model('ShopInfo');
  const [shops, total] = await Promise.all([
    ShopInfo.find(
      {},
      { shopCode: 1, shopName: 1, shopAddress: 1, shopContact: 1, shopContactPerson: 1, price: 1 }
    )
      .skip(skip)
      .limit(limit)
      .lean(),
    ShopInfo.countDocuments({}),
  ]);

  return response.successResponse(200, ctx.event, {
    message: 'success.retrieved',
    data: shops,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}
