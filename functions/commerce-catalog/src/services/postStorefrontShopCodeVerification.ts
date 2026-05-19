import type { APIGatewayProxyResult } from 'aws-lambda';
import { parseBody, parseMultipartBody } from '@aws-ddd-api/shared/validation/zod';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { ensureShopInfoModel } from '../config/models';
import { response } from '../utils/response';
import { verifyShopCodeBodySchema } from '../zodSchema/verifyShopCodeBodySchema';

type StorefrontShop = {
  shopCode?: unknown;
  price?: unknown;
};

type CanonicalShop = {
  shopCode: string;
  price: unknown | null;
};

type MultipartFile = {
  fieldname: string;
  filename?: string;
  contentType?: string;
  content?: Buffer;
};

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

function extractShopCodeFromPdfBuffer(
  buffer: Buffer,
  canonicalCodeMap: Map<string, CanonicalShop>
): string | null {
  const rawText = buffer.toString('latin1').toUpperCase();
  const entries = [...canonicalCodeMap.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [normalizedCode, canonicalShop] of entries) {
    if (rawText.includes(normalizedCode)) {
      return canonicalShop.shopCode;
    }
  }
  return null;
}

async function loadCanonicalShopCodeMap(): Promise<Map<string, CanonicalShop>> {
  const ShopInfo = ensureShopInfoModel();
  const shops = (await ShopInfo.find({}, { shopCode: 1, price: 1 }).lean()) as StorefrontShop[];
  const map = new Map<string, CanonicalShop>();
  for (const shop of shops) {
    const code = normalizeShopCode(shop.shopCode);
    if (!code) continue;
    map.set(code.toUpperCase(), {
      shopCode: code,
      price: shop.price ?? null,
    });
  }
  return map;
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
        price: null,
      },
    });
  }

  const matchedShop = canonicalCodeMap.get(resolvedShopCode.toUpperCase()) ?? null;
  return response.successResponse(200, ctx.event, {
    message: 'success.retrieved',
    data: {
      isValid: Boolean(matchedShop),
      source,
      shopCode: resolvedShopCode,
      matchedShopCode: matchedShop?.shopCode ?? null,
      price: matchedShop?.price ?? null,
    },
  });
}
