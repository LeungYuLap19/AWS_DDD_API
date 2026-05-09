import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { parseBody, paginationQuerySchema } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { catalogEventBodySchema } from '../zodSchema/catalogEventBodySchema';
import { applyRateLimit } from '../utils/rateLimit';
import { response } from '../utils/response';

/**
 * Returns the paginated commerce catalog from `ProductList` for storefront
 * browsing. Query validation is limited to shared pagination parameters.
 */
export async function handleGetCatalog(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  await connectToMongoDB();

  const pagination = paginationQuerySchema().safeParse(ctx.event.queryStringParameters ?? {});
  if (!pagination.success) {
    return response.errorResponse(400, 'common.invalidQueryParams', ctx.event);
  }
  const { page, limit } = pagination.data;
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

/**
 * Persists a catalog-access analytics event behind x-api-key protection plus a
 * global/IP rate limit so leaked frontend credentials cannot flood
 * `ProductLog`.
 */
export async function handleCreateCatalogEvent(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const parsed = parseBody(ctx.body, catalogEventBodySchema);
  if (!parsed.ok) {
    return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
  }

  await connectToMongoDB();

  // Endpoint is x-api-key gated (Authorizer: NONE) but the key is embedded in
  // the frontend bundle. Cap by IP and provide a global ceiling so that a
  // leaked key cannot be used to flood the ProductLog collection.
  const rateLimitResponse = await applyRateLimit({
    action: 'commerce.catalog.events',
    event: ctx.event,
    identifier: parsed.data.userId ?? null,
    policies: [
      { scope: 'ip', limit: 120, windowSeconds: 60 },
      { scope: 'global', limit: 5000, windowSeconds: 60 },
    ],
  });
  if (rateLimitResponse) return rateLimitResponse;

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
