import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { parseObjectIdParam } from '@aws-ddd-api/shared/validation/common';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { ensurePtagProductModel } from '../config/models';
import { response } from '../utils/response';

type PtagProductOptionSet = {
  sizes?: unknown;
  colours?: unknown;
};

type PtagProductTier = {
  type?: unknown;
  price?: unknown;
};

type PtagProductDocument = {
  _id?: unknown;
  name?: unknown;
  deliveryCharge?: unknown;
  options?: PtagProductOptionSet;
  tiers?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

type PtagProductResponse = {
  productId: string;
  name: string | null;
  deliveryCharge: number | null;
  options: {
    sizes: string[];
    colours: string[];
  };
  tiers: Array<{
    type: string;
    price: number | null;
  }>;
  createdAt: string | null;
  updatedAt: string | null;
};

const PTAG_PRODUCTS_LIST_PROJECTION = {
  name: 1,
  deliveryCharge: 1,
  options: 1,
  tiers: 1,
  createdAt: 1,
  updatedAt: 1,
} as const;

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function asIsoStringOrNull(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.valueOf())) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isFinite(parsed.valueOf()) ? parsed.toISOString() : null;
  }
  return null;
}

function sanitizePtagProduct(doc: PtagProductDocument): PtagProductResponse {
  const tiersRaw = Array.isArray(doc.tiers) ? (doc.tiers as PtagProductTier[]) : [];
  return {
    productId: String(doc._id ?? ''),
    name: asStringOrNull(doc.name),
    deliveryCharge: asNumberOrNull(doc.deliveryCharge),
    options: {
      sizes: asStringArray(doc.options?.sizes),
      colours: asStringArray(doc.options?.colours),
    },
    tiers: tiersRaw
      .map((tier) => {
        const tierType = asStringOrNull(tier?.type);
        if (!tierType) return null;
        return {
          type: tierType,
          price: asNumberOrNull(tier?.price),
        };
      })
      .filter((tier): tier is { type: string; price: number | null } => Boolean(tier)),
    createdAt: asIsoStringOrNull(doc.createdAt),
    updatedAt: asIsoStringOrNull(doc.updatedAt),
  };
}

/**
 * GET /commerce/catalog/ptag-products
 * Returns ptag products from MongoDB with a stable API response shape.
 */
export async function handleGetPtagProducts(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  await connectToMongoDB();

  const PtagProduct = ensurePtagProductModel();
  const rows = (await PtagProduct.find({}, PTAG_PRODUCTS_LIST_PROJECTION)
    .sort({ createdAt: -1, _id: -1 })
    .lean()) as PtagProductDocument[];

  return response.successResponse(200, ctx.event, {
    message: 'success.retrieved',
    data: rows.map(sanitizePtagProduct),
  });
}

/**
 * GET /commerce/catalog/ptag-products/{productId}
 * Returns a single ptag product by MongoDB ObjectId.
 */
export async function handleGetPtagProductById(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const productIdParam = parseObjectIdParam(ctx.event.pathParameters?.productId);
  if (!productIdParam.ok) {
    return response.errorResponse(productIdParam.statusCode, productIdParam.errorKey, ctx.event);
  }

  await connectToMongoDB();

  const PtagProduct = ensurePtagProductModel();
  const row = (await PtagProduct.findById(productIdParam.data, PTAG_PRODUCTS_LIST_PROJECTION).lean()) as PtagProductDocument | null;
  if (!row) {
    return response.errorResponse(404, 'common.notFound', ctx.event);
  }

  return response.successResponse(200, ctx.event, {
    message: 'success.retrieved',
    data: sanitizePtagProduct(row),
  });
}

export const __private = {
  sanitizePtagProduct,
};
