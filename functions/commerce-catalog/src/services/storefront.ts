import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { parseBody, parseMultipartBody, paginationQuerySchema } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { response } from '../utils/response';
import { verifyShopCodeBodySchema } from '../zodSchema/verifyShopCodeBodySchema';

type StorefrontShop = {
  shopCode?: unknown;
  shopName?: unknown;
  shopAddress?: unknown;
  shopContact?: unknown;
  shopContactPerson?: unknown;
  price?: unknown;
};

type MultipartFile = {
  fieldname: string;
  filename?: string;
  contentType?: string;
  content?: Buffer;
};

const STOREFRONT_PROJECTION = {
  shopCode: 1,
  shopName: 1,
  shopAddress: 1,
  shopContact: 1,
  shopContactPerson: 1,
  price: 1,
} as const;

function normalizeShopCode(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function getHeaderValue(headers: Record<string, string | undefined> | null | undefined, key: string): string {
  if (!headers) return '';
  const direct = headers[key];
  if (typeof direct === 'string') return direct;
  const lower = key.toLowerCase();
  for (const [headerKey, headerValue] of Object.entries(headers)) {
    if (headerKey.toLowerCase() === lower && typeof headerValue === 'string') {
      return headerValue;
    }
  }
  return '';
}

function isPdfFile(file: MultipartFile): boolean {
  const contentType = (file.contentType ?? '').toLowerCase();
  if (contentType === 'application/pdf' || contentType === 'application/x-pdf') {
    return true;
  }
  const filename = (file.filename ?? '').toLowerCase();
  return filename.endsWith('.pdf');
}

function extractShopCodeFromPdfBuffer(buffer: Buffer, canonicalCodeMap: Map<string, string>): string | null {
  const rawText = buffer.toString('latin1').toUpperCase();
  const entries = [...canonicalCodeMap.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [normalizedCode, canonicalCode] of entries) {
    if (rawText.includes(normalizedCode)) {
      return canonicalCode;
    }
  }
  return null;
}

async function listStorefrontShops(page: number, limit: number): Promise<{ shops: StorefrontShop[]; total: number }> {
  const skip = (page - 1) * limit;
  const ShopInfo = mongoose.model('ShopInfo');
  const [shops, total] = await Promise.all([
    ShopInfo.find({}, STOREFRONT_PROJECTION).skip(skip).limit(limit).lean(),
    ShopInfo.countDocuments({}),
  ]);
  return { shops: shops as StorefrontShop[], total: total as number };
}

async function loadCanonicalShopCodeMap(): Promise<Map<string, string>> {
  const ShopInfo = mongoose.model('ShopInfo');
  const shops = (await ShopInfo.find({}, { shopCode: 1 }).lean()) as StorefrontShop[];
  const map = new Map<string, string>();
  for (const shop of shops) {
    const code = normalizeShopCode(shop.shopCode);
    if (!code) continue;
    map.set(code.toUpperCase(), code);
  }
  return map;
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

/**
 * Verifies a shop code against storefront shops. Accepts either:
 * - JSON body `{ shopCode }`
 * - multipart form with `shopCode` and optional PDF, or PDF only
 */
export async function handlePostStorefrontShopCodeVerification(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const contentType = getHeaderValue(ctx.event.headers as Record<string, string | undefined> | undefined, 'content-type');
  const isMultipart = contentType.toLowerCase().includes('multipart/form-data');

  let shopCode = '';
  let files: MultipartFile[] = [];

  if (isMultipart) {
    const parsed = await parseMultipartBody(ctx.event, verifyShopCodeBodySchema, {
      fallbackErrorKey: 'common.invalidBodyParams',
    });
    if (!parsed.ok) {
      return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
    }
    shopCode = normalizeShopCode(parsed.data.shopCode);
    files = parsed.files as MultipartFile[];
  } else {
    const parsed = parseBody(ctx.body, verifyShopCodeBodySchema, {
      requireNonEmpty: false,
      fallbackErrorKey: 'common.invalidBodyParams',
      malformedJsonErrorKey: 'common.invalidJSON',
    });
    if (!parsed.ok) {
      return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
    }
    shopCode = normalizeShopCode(parsed.data.shopCode);
  }

  await connectToMongoDB();
  const canonicalCodeMap = await loadCanonicalShopCodeMap();
  let source: 'shopCode' | 'pdf' = 'shopCode';
  let resolvedShopCode: string | null = shopCode || null;

  if (!resolvedShopCode) {
    if (files.length === 0) {
      return response.errorResponse(400, 'catalog.errors.shopCodeOrPdfRequired', ctx.event);
    }

    const pdfFile = files.find(isPdfFile);
    if (!pdfFile) {
      return response.errorResponse(400, 'catalog.errors.invalidVerificationFileType', ctx.event);
    }

    source = 'pdf';
    resolvedShopCode = pdfFile.content
      ? extractShopCodeFromPdfBuffer(pdfFile.content, canonicalCodeMap)
      : null;
  }

  if (!resolvedShopCode) {
    return response.successResponse(200, ctx.event, {
      message: 'success.retrieved',
      data: {
        isValid: false,
        source,
        shopCode: null,
        matchedShopCode: null,
      },
    });
  }

  const matchedShopCode = canonicalCodeMap.get(resolvedShopCode.toUpperCase()) ?? null;
  return response.successResponse(200, ctx.event, {
    message: 'success.retrieved',
    data: {
      isValid: Boolean(matchedShopCode),
      source,
      shopCode: resolvedShopCode,
      matchedShopCode,
    },
  });
}
