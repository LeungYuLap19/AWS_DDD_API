import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { response } from '../utils/response';

export async function handleGetStorefront(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  await connectToMongoDB();

  const params = ctx.event.queryStringParameters ?? {};
  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(params.limit ?? '100', 10) || 100));
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
