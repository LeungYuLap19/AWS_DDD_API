import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import multipart from 'lambda-multipart-parser';
import axios from 'axios';
import {
  getFirstZodIssueMessage,
  requireAuthContext,
  requireRole,
} from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import env from '../config/env';
import { purchaseConfirmationSchema } from '../zodSchema/orderSchema';
import { sanitizeOrder, sanitizeOrderVerification } from '../utils/sanitize';
import {
  addImageFileToStorage,
  uploadQrCodeImage,
  ALLOWED_UPLOAD_MIME,
  MAX_UPLOAD_BYTES,
  detectMimeFromBuffer,
} from '../utils/s3';
import { sendOrderEmail } from '../utils/smtp';
import { sendWhatsAppOrderMessage } from '../utils/whatsapp';
import { applyRateLimit } from '../utils/rateLimit';
import { response } from '../utils/response';

// ── Auth helpers ─────────────────────────────────────────────────────────────

const PRIVILEGED_ROLES = new Set(['admin', 'developer']);

function normalizeEmail(email: unknown): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

// ── File validation ──────────────────────────────────────────────────────────

interface MultipartFile {
  content: Buffer;
  filename: string;
  fieldname: string;
  contentType: string;
  encoding: string;
}

function validateUploadFiles(files: MultipartFile[], maxCount = 1): string | null {
  if (files.length > maxCount) return 'orders.errors.tooManyFiles';
  for (const f of files) {
    if (f.content.length > MAX_UPLOAD_BYTES) return 'orders.errors.fileTooLarge';
    const detectedMime = detectMimeFromBuffer(f.content);
    if (!detectedMime || !ALLOWED_UPLOAD_MIME.has(detectedMime)) return 'orders.errors.invalidFileType';
  }
  return null;
}

// ── Tag ID generation ────────────────────────────────────────────────────────

const ALPHABET = 'ACDEFGHJKLMNPQRTUVWXYZ';
const NUMBERS = '23456789';

function pick(chars: string): string {
  return chars[Math.floor(Math.random() * chars.length)];
}

function generateTagId(): string {
  return pick(ALPHABET) + pick(NUMBERS) + pick(ALPHABET) + pick(NUMBERS) + pick(ALPHABET) + pick(NUMBERS);
}

async function generateUniqueTagId(): Promise<string> {
  const OrderVerification = mongoose.model('OrderVerification');
  let tagId: string;
  do {
    tagId = generateTagId();
  } while (await OrderVerification.findOne({ tagId }, { _id: 1 }).lean());
  return tagId;
}

// ── Pricing ──────────────────────────────────────────────────────────────────

async function resolveCanonicalPrice(shopCode: string): Promise<{ canonicalPrice: number } | null> {
  if (!shopCode) return null;
  const ShopInfo = mongoose.model('ShopInfo');
  const shop = (await ShopInfo.findOne({ shopCode }, { price: 1 }).lean()) as { price?: unknown } | null;
  if (!shop) return null;
  const canonicalPrice = typeof shop.price === 'number' ? shop.price : parseFloat(String(shop.price)) || 0;
  return { canonicalPrice };
}

// ── URL shortening ────────────────────────────────────────────────────────────

async function shortenUrl(longUrl: string): Promise<string> {
  const apiKey = env.CUTTLY_API_KEY;
  if (!apiKey) return longUrl;
  try {
    const res = await axios.get<{ url?: { shortLink?: string } }>('https://cutt.ly/api/api.php', {
      params: { key: apiKey, short: longUrl },
      timeout: 3000,
    });
    if (res.data?.url?.shortLink) return res.data.url.shortLink;
    return longUrl;
  } catch {
    return longUrl;
  }
}

async function resolveShortUrl(isPTagAir: boolean, tagId: string): Promise<string> {
  if (isPTagAir) return 'www.ptag.com.hk/landing';
  return shortenUrl(`https://www.ptag.com.hk/php/qr_info.php?qr=${tagId}`);
}

// ── GET /commerce/orders ─────────────────────────────────────────────────────

/**
 * GET /commerce/orders
 * Admin-protected — returns all orders with pagination.
 */
export async function handleGetOrders(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  requireRole(ctx.event, ['admin', 'developer']);

  await connectToMongoDB();
  const Order = mongoose.model('Order');

  const queryParams = ctx.event.queryStringParameters || {};
  const page = Math.max(1, parseInt(queryParams['page'] ?? '', 10) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(queryParams['limit'] ?? '', 10) || 100));
  const skip = (page - 1) * limit;

  const projection = {
    isPTagAir: 1, lastName: 1, email: 1, phoneNumber: 1, address: 1,
    paymentWay: 1, delivery: 1, tempId: 1, option: 1, type: 1, price: 1,
    petImg: 1, promotionCode: 1, shopCode: 1, buyDate: 1, petName: 1,
    petContact: 1, sfWayBillNumber: 1, language: 1, createdAt: 1, updatedAt: 1,
  };

  const [orders, total] = await Promise.all([
    Order.find({}, projection).skip(skip).limit(limit).lean(),
    Order.countDocuments({}),
  ]);

  return response.successResponse(200, ctx.event, {
    orders: (orders as Record<string, unknown>[]).map(sanitizeOrder),
    pagination: { page, limit, total },
  });
}

// ── POST /commerce/orders ─────────────────────────────────────────────────────

/**
 * POST /commerce/orders
 * Protected — authenticated user checkout via multipart/form-data.
 *
 * Intentional delta from legacy: legacy POST /purchase/confirmation was a public
 * route. The DDD template.yaml wires this through the default authorizer, making
 * it protected. This is an auth-strengthening delta.
 */
export async function handleCreateOrder(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  requireAuthContext(ctx.event);

  // 1. Rate limit (per IP, 10 requests/hour)
  const rateLimitResult = await applyRateLimit({
    action: 'submit-order',
    event: ctx.event,
    limit: 10,
    windowSeconds: 3600,
  });
  if (rateLimitResult) return rateLimitResult;

  // 2. Connect to DB
  await connectToMongoDB();

  // 3. Parse multipart form data
  const parsed = await multipart.parse(ctx.event);

  // 4. Zod validation
  const parseResult = purchaseConfirmationSchema.safeParse(parsed);
  if (!parseResult.success) {
    return response.errorResponse(
      400,
      getFirstZodIssueMessage(parseResult.error) ?? 'orders.errors.missingRequiredFields',
      ctx.event
    );
  }

  const {
    lastName, phoneNumber, address, email: rawEmail, option, type, tempId,
    paymentWay, shopCode, delivery, promotionCode, petContact,
    petName, optionSize, optionColor, lang,
  } = parseResult.data;

  const email = normalizeEmail(rawEmail);

  // 5. Validate and upload image files
  const allFiles = parsed.files || [];
  const petImgFiles = allFiles.filter((f) => f.fieldname === 'pet_img');
  const discountProofFiles = allFiles.filter((f) => f.fieldname === 'discount_proof');

  const fileError = validateUploadFiles(petImgFiles) || validateUploadFiles(discountProofFiles);
  if (fileError) {
    return response.errorResponse(400, fileError, ctx.event);
  }

  let petImgUrl = '';
  if (petImgFiles.length > 0) {
    const urls = await Promise.all(
      petImgFiles.map((f) =>
        addImageFileToStorage(
          { buffer: f.content, originalname: f.filename },
          `user-uploads/orders/${tempId}`,
          'user'
        )
      )
    );
    petImgUrl = urls[0] ?? '';
  }

  let discountProofUrl = '';
  if (discountProofFiles.length > 0) {
    const urls = await Promise.all(
      discountProofFiles.map((f) =>
        addImageFileToStorage(
          { buffer: f.content, originalname: f.filename },
          `user-uploads/orders/${tempId}/discount-proofs`,
          'user'
        )
      )
    );
    discountProofUrl = urls[0] ?? '';
  }

  // 6. Duplicate tempId guard
  const Order = mongoose.model('Order');
  if (await Order.findOne({ tempId }, { _id: 1 }).lean()) {
    return response.errorResponse(409, 'orders.errors.duplicateOrder', ctx.event);
  }

  // 7. Resolve server-authoritative price
  const priceResult = await resolveCanonicalPrice(shopCode);
  if (!priceResult) {
    return response.errorResponse(400, 'orders.errors.invalidShopCode', ctx.event);
  }
  const { canonicalPrice } = priceResult;

  // 8. Create Order
  const isPTagAir = option === 'PTagAir' || option === 'PTagAir_member';

  let order: Record<string, unknown>;
  try {
    const OrderModel = Order as unknown as new (data: Record<string, unknown>) => {
      save(): Promise<unknown>;
      _id: unknown;
      buyDate: unknown;
    };
    const newOrder = new OrderModel({
      lastName, phoneNumber, address, email, option, type, tempId,
      petImg: petImgUrl, paymentWay, shopCode, delivery, price: canonicalPrice,
      promotionCode, petContact, petName, buyDate: new Date(), isPTagAir,
      sfWayBillNumber: null, language: lang,
    });
    await newOrder.save();
    order = newOrder as unknown as Record<string, unknown>;
  } catch (saveErr) {
    if ((saveErr as { code?: number })?.code === 11000) {
      return response.errorResponse(409, 'orders.errors.duplicateOrder', ctx.event);
    }
    throw saveErr;
  }

  // 9–11. Generate tag, QR assets, and create OrderVerification.
  //       On any post-order failure, compensate by removing the Order.
  const OrderVerification = mongoose.model('OrderVerification');
  let savedVerification: Record<string, unknown>;
  const TAG_ID_MAX_RETRIES = 3;

  try {
    let tagIdAttempt = 0;
    while (true) {
      const tagId = await generateUniqueTagId();

      const shortUrl = await resolveShortUrl(isPTagAir, tagId);
      const qrUrl = isPTagAir
        ? `${env.AWS_BUCKET_BASE_URL}/pet-images/ptag+id.png`
        : await uploadQrCodeImage(shortUrl);

      try {
        const OVModel = OrderVerification as unknown as new (data: Record<string, unknown>) => {
          save(): Promise<unknown>;
          _id: unknown;
        };
        const ov = new OVModel({
          tagId, staffVerification: false,
          contact: phoneNumber,
          verifyDate: null,
          tagCreationDate: order['buyDate'],
          petName, masterEmail: email, shortUrl, qrUrl,
          petUrl: petImgUrl, orderId: tempId, location: address,
          petHuman: lastName, pendingStatus: false, option, type,
          optionSize, optionColor, price: canonicalPrice,
          discountProof: discountProofUrl, cancelled: false,
        });
        await ov.save();
        savedVerification = ov as unknown as Record<string, unknown>;
        break;
      } catch (ovErr) {
        if ((ovErr as { code?: number })?.code === 11000 && ++tagIdAttempt < TAG_ID_MAX_RETRIES) {
          continue; // tagId collision — retry
        }
        throw ovErr;
      }
    }
  } catch (postOrderErr) {
    // Compensate: remove dangling Order so the user can retry with the same tempId
    await Order.deleteOne({ _id: order['_id'] }).catch(() => {});
    throw postOrderErr;
  }

  const newOrderVerificationId = savedVerification!['_id'];

  // 12 & 13. Send confirmation email + WhatsApp notification in parallel (both non-fatal).
  // Running sequentially risks cutt.ly(3s) + SMTP(4s) + WhatsApp(4s) = 11s > Lambda 10s limit.
  await Promise.all([
    sendOrderEmail(
      email,
      `PTag 訂單資料：${tempId}`,
      {
        lastName, phoneNumber, address, email, option, type, tempId,
        petImg: petImgUrl, paymentWay, shopCode, delivery, price: canonicalPrice,
        promotionCode, petContact, petName, optionColor, optionSize, isPTagAir,
      },
      'support@ptag.com.hk',
      newOrderVerificationId
    ).catch(() => {}),
    sendWhatsAppOrderMessage(
      { phoneNumber, lastName, option, tempId, lang },
      newOrderVerificationId
    ).catch(() => {}),
  ]);

return response.successResponse(200, ctx.event, {
  message: 'Order placed successfully.',
  purchase_code: tempId,
  price: canonicalPrice,
  _id: String(newOrderVerificationId),
});
}

// ── GET /commerce/orders/{tempId} ────────────────────────────────────────────

/**
 * GET /commerce/orders/{tempId}
 * Protected — returns pet contact summary for one order identified by tempId.
 * Admin/developer can access any order; regular users can only access their own (email match).
 */
export async function handleGetOrderByTempId(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authCtx = requireAuthContext(ctx.event);
  const tempId = ctx.event.pathParameters?.['tempId'];

  if (!tempId) {
    return response.errorResponse(400, 'orders.errors.missingTempId', ctx.event);
  }

  await connectToMongoDB();
  const Order = mongoose.model('Order');

  const order = (await Order
    .findOne({ tempId })
    .select('_id tempId lastName email phoneNumber petContact sfWayBillNumber language')
    .lean()) as Record<string, unknown> | null;

  if (!order) {
    return response.errorResponse(404, 'orders.errors.orderNotFound', ctx.event);
  }

  // Ownership check: admin/developer bypass, regular users must match email
  if (!PRIVILEGED_ROLES.has(authCtx.userRole ?? '')) {
    const callerEmail = normalizeEmail(authCtx.userEmail);
    const ownerEmail = normalizeEmail(order['email'] as string);
    if (!callerEmail || !ownerEmail || callerEmail !== ownerEmail) {
      return response.errorResponse(403, 'common.forbidden', ctx.event);
    }
  }

  const safeOrder = sanitizeOrder(order);
  return response.successResponse(200, ctx.event, {
    message: 'Order info retrieved successfully.',
    form: { petContact: safeOrder['petContact'] as string | undefined },
    id: String(safeOrder['_id']),
  });
}

// ── GET /commerce/orders/operations ─────────────────────────────────────────

/**
 * GET /commerce/orders/operations
 * Admin/developer protected — returns operations list of all order-verification records.
 */
export async function handleGetOperations(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  requireRole(ctx.event, ['admin', 'developer']);

  await connectToMongoDB();
  const OrderVerification = mongoose.model('OrderVerification');

  const queryParams = ctx.event.queryStringParameters || {};
  const page = Math.max(1, parseInt(queryParams['page'] ?? '', 10) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(queryParams['limit'] ?? '', 10) || 100));
  const skip = (page - 1) * limit;

  const filter = { cancelled: { $exists: true } };
  const selectFields =
    '_id tagId staffVerification contact verifyDate tagCreationDate petName shortUrl ' +
    'masterEmail qrUrl petUrl orderId location petHuman createdAt updatedAt ' +
    'pendingStatus option type optionSize optionColor price cancelled';

  const [allOrders, total] = await Promise.all([
    (OrderVerification
      .find(filter)
      .select(selectFields)
      .skip(skip)
      .limit(limit)
      .lean()) as Promise<Record<string, unknown>[]>,
    OrderVerification.countDocuments(filter),
  ]);

  if (!allOrders || allOrders.length === 0) {
    return response.errorResponse(404, 'orders.errors.noOrders', ctx.event);
  }

  return response.successResponse(200, ctx.event, {
    message: 'Latest PTag orders retrieved successfully.',
    allOrders: allOrders.map(sanitizeOrderVerification),
    pagination: { page, limit, total },
  });
}

