import type { APIGatewayProxyResult } from 'aws-lambda';
import { paginationQuerySchema } from '@aws-ddd-api/shared/validation/common';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { ensureShopInfoModel } from '../config/models';
import { response } from '../utils/response';

type StorefrontShop = {
  shopCode?: unknown;
  shopName?: unknown;
  shopAddress?: unknown;
  shopContact?: unknown;
  shopContactPerson?: unknown;
  price?: unknown;
};

const STOREFRONT_PROJECTION = {
  shopCode: 1,
  shopName: 1,
  shopAddress: 1,
  shopContact: 1,
  shopContactPerson: 1,
  price: 1,
} as const;

async function listStorefrontShops(page: number, limit: number): Promise<{ shops: StorefrontShop[]; total: number }> {
  const skip = (page - 1) * limit;
  const ShopInfo = ensureShopInfoModel();
  const [shops, total] = await Promise.all([
    ShopInfo.find({}, STOREFRONT_PROJECTION).skip(skip).limit(limit).lean(),
    ShopInfo.countDocuments({}),
  ]);
  return { shops: shops as StorefrontShop[], total: total as number };
}

/**
 * Returns the paginated storefront shop directory with a narrow public field
 * projection so callers only receive the data needed for checkout selection.
 */
export async function handleGetStorefront(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const pagination = paginationQuerySchema().safeParse(ctx.event.queryStringParameters ?? {});
  if (!pagination.success) {
    return response.errorResponse(400, 'common.invalidQueryParams', ctx.event);
  }
  const { page, limit } = pagination.data;

  await connectToMongoDB();
  const { shops, total } = await listStorefrontShops(page, limit);

  return response.successResponse(200, ctx.event, {
    message: 'success.retrieved',
    data: shops,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}
