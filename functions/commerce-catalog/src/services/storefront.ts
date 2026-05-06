import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { response } from '../utils/response';

export async function handleGetStorefront(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  await connectToMongoDB();
  const ShopInfo = mongoose.model('ShopInfo');
  const shops = await ShopInfo.find(
    {},
    { shopCode: 1, shopName: 1, shopAddress: 1, shopContact: 1, shopContactPerson: 1, price: 1 }
  ).lean();
  return response.successResponse(200, ctx.event, { shops });
}
