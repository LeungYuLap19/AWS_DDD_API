import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { parseBody } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { catalogEventBodySchema } from '../zodSchema/catalogEventBodySchema';
import { response } from '../utils/response';

export async function handleGetCatalog(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  await connectToMongoDB();

  const queryParams = ctx.event.queryStringParameters || {};
  const page = Math.max(1, parseInt(queryParams['page'] ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(queryParams['limit'] ?? '30', 10) || 30));
  const skip = (page - 1) * limit;

  const ProductList = mongoose.model('ProductList');
  const [items, total] = await Promise.all([
    ProductList.find({}).skip(skip).limit(limit).lean(),
    ProductList.countDocuments({}),
  ]);

  return response.successResponse(200, ctx.event, {
    message: 'success.retrieved',
    data: items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
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

  return response.successResponse(201, ctx.event, { message: 'success.created', data: { id: log._id } });
}
