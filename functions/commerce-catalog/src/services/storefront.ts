import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { response } from '../utils/response';

export async function handleGetStorefront(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  await connectToMongoDB();

  const queryParams = ctx.event.queryStringParameters || {};
  const page = Math.max(1, parseInt(queryParams['page'] ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(queryParams['limit'] ?? '30', 10) || 30));
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
