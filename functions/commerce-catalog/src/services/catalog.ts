import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { parseBody } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { catalogEventBodySchema } from '../zodSchema/catalogEventBodySchema';
import { response } from '../utils/response';

export async function handleGetCatalog(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  await connectToMongoDB();
  const ProductList = mongoose.model('ProductList');
  const items = await ProductList.find({}).lean();
  return response.successResponse(200, ctx.event, { items });
}

export async function handleCreateCatalogEvent(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const parsed = parseBody(ctx.body, catalogEventBodySchema);
  if (!parsed.ok) {
    return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
  }

  await connectToMongoDB();
  const ProductLog = mongoose.model('ProductLog');
  const { petId, userId, userEmail, productUrl, accessAt } = parsed.data;

  const log = await ProductLog.create({
    petId,
    userId,
    userEmail,
    productUrl,
    accessAt: accessAt ? new Date(accessAt) : null,
  });

  return response.successResponse(201, ctx.event, { id: log._id });
}
