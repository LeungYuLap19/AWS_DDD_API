import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { requireAuthContext, requireRole } from '@aws-ddd-api/shared/auth/context';
import { logWarn } from '@aws-ddd-api/shared/logging/logger';
import { paginationQuerySchema, parsePathParam, tempIdString } from '@aws-ddd-api/shared/validation/common';
import { parseMultipartBody } from '@aws-ddd-api/shared/validation/zod';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import env from '../config/env';
import { purchaseConfirmationSchema } from '../zodSchema/orderSchema';
import { sanitizeOrder, sanitizeOrderVerification } from '../utils/sanitize';
import { uploadImageFile } from '../utils/upload';
import { uploadQrCodeImage } from '../utils/s3';
import {
  normalizeEmail,
  generateUniqueTagId,
  resolveAuthoritativePricing,
  resolveShortUrl,
} from '../utils/helpers';
import { sendOrderEmail } from '../utils/smtp';
import { sendWhatsAppOrderMessage } from '../utils/whatsapp';
import { applyRateLimit } from '../utils/rateLimit';
import { response } from '../utils/response';

// ── Auth helpers ─────────────────────────────────────────────────────────────

const PRIVILEGED_ROLES = new Set(['admin', 'developer']);
const TAG_ID_MAX_RETRIES = 3;

type ParsedMultipartOrder = {
  lastName: string;
  phoneNumber: string;
  address: string;
  email: string;
  option: string;
  type: string;
  tempId: string;
  paymentWay: string;
  shopCode: string;
  delivery: string;
  promotionCode: string;
  petContact: string;
  petName: string;
  optionSize: string;
  optionColor: string;
  lang: 'chn' | 'eng';
};

type UploadedOrderFiles = {
  petImgUrl: string;
  discountProofUrl: string;
};

type CheckoutFile = {
  fieldname: string;
  filename?: string;
  content?: Buffer;
};

type CreatedOrderRecord = {
  _id: unknown;
  buyDate: unknown;
};

type CreatedOrderVerificationRecord = {
  _id: unknown;
};

function isPTagAirOption(option: string): boolean {
  return option === 'PTagAir' || option === 'PTagAir_member';
}

async function uploadOptionalOrderFiles(
  ctx: RouteContext,
  tempId: string,
  files: CheckoutFile[]
): Promise<UploadedOrderFiles | APIGatewayProxyResult> {
  const petImgFiles = files.filter((f) => f.fieldname === 'pet_img');
  const discountProofFiles = files.filter((f) => f.fieldname === 'discount_proof');

  if (petImgFiles.length > 1) {
    return response.errorResponse(400, 'orders.errors.tooManyFiles', ctx.event);
  }
  if (discountProofFiles.length > 1) {
    return response.errorResponse(400, 'orders.errors.tooManyFiles', ctx.event);
  }

  const uploadSingleFile = async (
    fieldFile: { filename?: string; content?: Buffer } | undefined,
    keyPrefix: string
  ): Promise<string | APIGatewayProxyResult> => {
    if (!fieldFile?.content) return '';
    try {
      return await uploadImageFile(
        { buffer: fieldFile.content, originalname: fieldFile.filename ?? '' },
        keyPrefix,
        'user'
      );
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'INVALID_FILE_TYPE') return response.errorResponse(400, 'orders.errors.invalidFileType', ctx.event);
      if (code === 'FILE_TOO_LARGE') return response.errorResponse(413, 'orders.errors.fileTooLarge', ctx.event);
      throw err;
    }
  };

  const petImgUrl = await uploadSingleFile(petImgFiles[0], `user-uploads/orders/${tempId}`);
  if (typeof petImgUrl !== 'string') return petImgUrl;

  const discountProofUrl = await uploadSingleFile(
    discountProofFiles[0],
    `user-uploads/orders/${tempId}/discount-proofs`
  );
  if (typeof discountProofUrl !== 'string') return discountProofUrl;

  return { petImgUrl, discountProofUrl };
}

async function createOrderDocument(
  data: ParsedMultipartOrder & UploadedOrderFiles & { normalizedEmail: string; finalPrice: number; isPTagAir: boolean }
): Promise<CreatedOrderRecord | 'DUPLICATE'> {
  const Order = mongoose.model('Order');

  try {
    const OrderModel = Order as unknown as new (payload: Record<string, unknown>) => {
      save(): Promise<unknown>;
      _id: unknown;
      buyDate: unknown;
    };
    const newOrder = new OrderModel({
      lastName: data.lastName,
      phoneNumber: data.phoneNumber,
      address: data.address,
      email: data.normalizedEmail,
      option: data.option,
      type: data.type,
      tempId: data.tempId,
      petImg: data.petImgUrl,
      paymentWay: data.paymentWay,
      shopCode: data.shopCode,
      delivery: data.delivery,
      price: data.finalPrice,
      promotionCode: data.promotionCode,
      petContact: data.petContact,
      petName: data.petName,
      buyDate: new Date(),
      isPTagAir: data.isPTagAir,
      sfWayBillNumber: null,
      language: data.lang,
    });
    await newOrder.save();
    return newOrder as unknown as CreatedOrderRecord;
  } catch (saveErr) {
    if ((saveErr as { code?: number })?.code === 11000) {
      return 'DUPLICATE';
    }
    throw saveErr;
  }
}

async function createOrderVerificationWithRetry(
  order: CreatedOrderRecord,
  data: ParsedMultipartOrder &
    UploadedOrderFiles &
    { normalizedEmail: string; finalPrice: number; isPTagAir: boolean }
): Promise<CreatedOrderVerificationRecord> {
  const OrderVerification = mongoose.model('OrderVerification');

  let retries = 0;
  while (true) {
    const tagId = await generateUniqueTagId();
    const shortUrl = await resolveShortUrl(data.isPTagAir, tagId);
    const qrUrl = data.isPTagAir
      ? `${env.AWS_BUCKET_BASE_URL}/pet-images/ptag+id.png`
      : await uploadQrCodeImage(shortUrl);

    try {
      const OVModel = OrderVerification as unknown as new (payload: Record<string, unknown>) => {
        save(): Promise<unknown>;
        _id: unknown;
      };

      const ov = new OVModel({
        tagId,
        staffVerification: false,
        contact: data.phoneNumber,
        verifyDate: null,
        tagCreationDate: order.buyDate,
        petName: data.petName,
        masterEmail: data.normalizedEmail,
        shortUrl,
        qrUrl,
        petUrl: data.petImgUrl,
        orderId: data.tempId,
        location: data.address,
        petHuman: data.lastName,
        pendingStatus: false,
        option: data.option,
        type: data.type,
        optionSize: data.optionSize,
        optionColor: data.optionColor,
        price: data.finalPrice,
        discountProof: data.discountProofUrl,
        cancelled: false,
      });
      await ov.save();
      return ov as unknown as CreatedOrderVerificationRecord;
    } catch (ovErr) {
      if ((ovErr as { code?: number })?.code === 11000 && retries < TAG_ID_MAX_RETRIES - 1) {
        retries += 1;
        continue;
      }
      throw ovErr;
    }
  }
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

  const pagination = paginationQuerySchema().safeParse(ctx.event.queryStringParameters ?? {});
  if (!pagination.success) {
    return response.errorResponse(400, 'common.invalidQueryParams', ctx.event);
  }
  const { page, limit } = pagination.data;
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
    message: 'success.retrieved',
    data: (orders as Record<string, unknown>[]).map(sanitizeOrder),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
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
  const auth = requireAuthContext(ctx.event);

  // 1. Parse multipart form data + Zod validation
  const multiResult = await parseMultipartBody(ctx.event, purchaseConfirmationSchema, {
    fallbackErrorKey: 'common.invalidBodyParams',
  });
  if (!multiResult.ok) {
    return response.errorResponse(multiResult.statusCode, multiResult.errorKey, ctx.event);
  }

  const {
    lastName, phoneNumber, address, email: rawEmail, option, type, tempId,
    paymentWay, shopCode, delivery, promotionCode, petContact,
    petName, optionSize, optionColor, lang,
  } = multiResult.data;

  const email = normalizeEmail(rawEmail);
  const parsedOrder: ParsedMultipartOrder = {
    lastName,
    phoneNumber,
    address,
    email,
    option,
    type,
    tempId,
    paymentWay,
    shopCode,
    delivery,
    promotionCode,
    petContact,
    petName,
    optionSize,
    optionColor,
    lang,
  };

  // 2. Connect to DB first — rate limiter uses mongoose and needs an open connection.
  await connectToMongoDB();

  // 3. Layered rate limit. The narrow ip+account lane preserves the legacy
  //    10/hr behaviour. Wider ip lane bounds anonymous probing and per-account
  //    lane bounds an attacker rotating IPs against one account.
  const rateLimitResult = await applyRateLimit({
    action: 'submit-order',
    event: ctx.event,
    identifier: auth.userId,
    policies: [
      { scope: 'ip', limit: 60, windowSeconds: 3600 },
      { scope: 'identifier', limit: 20, windowSeconds: 3600 },
      { scope: 'ip+identifier', limit: 10, windowSeconds: 3600 },
    ],
  });
  if (rateLimitResult) return rateLimitResult;

  // 4. Resolve backend-authoritative pricing from DB data only.
  // Formula: finalPrice = itemBasePrice - shopCodeDiscount + deliveryFee
  const pricing = await resolveAuthoritativePricing({
    option: parsedOrder.option,
    type: parsedOrder.type,
    shopCode: parsedOrder.shopCode,
    optionSize: parsedOrder.optionSize,
    optionColor: parsedOrder.optionColor,
  });
  if (!pricing.ok) {
    if (
      pricing.error === 'INVALID_PRODUCT_SELECTION' ||
      pricing.error === 'INVALID_OPTION_SIZE' ||
      pricing.error === 'INVALID_OPTION_COLOUR'
    ) {
      return response.errorResponse(400, 'orders.errors.invalidProductSelection', ctx.event);
    }
    return response.errorResponse(400, 'orders.errors.invalidShopCode', ctx.event);
  }
  const { finalPrice, deliveryFee } = pricing.data;

  // 5. Upload optional files after pricing is validated.
  const normalizedFiles: CheckoutFile[] = multiResult.files
    .filter((file): file is typeof file & { fieldname: string } => typeof file.fieldname === 'string')
    .map((file) => ({
      fieldname: file.fieldname,
      filename: file.filename,
      content: file.content,
    }));

  const fileUpload = await uploadOptionalOrderFiles(ctx, parsedOrder.tempId, normalizedFiles);
  if ('statusCode' in fileUpload) {
    return fileUpload;
  }
  const { petImgUrl, discountProofUrl } = fileUpload;

  // 6. Persist order.
  const isPTagAir = isPTagAirOption(parsedOrder.option);
  const createOrderInput = {
    ...parsedOrder,
    normalizedEmail: email,
    finalPrice,
    isPTagAir,
    petImgUrl,
    discountProofUrl,
  };
  const order = await createOrderDocument(createOrderInput);
  if (order === 'DUPLICATE') {
    return response.errorResponse(409, 'orders.errors.duplicateOrder', ctx.event);
  }

  // 7. Persist order verification; compensate order if this fails.
  const Order = mongoose.model('Order');
  let savedVerification: CreatedOrderVerificationRecord;

  try {
    savedVerification = await createOrderVerificationWithRetry(order, createOrderInput);
  } catch (postOrderErr) {
    // Compensate: remove dangling Order so the user can retry with the same tempId
    await Order.deleteOne({ _id: order._id }).catch((error) =>
      logWarn('Order compensation delete failed', {
        event: ctx.event,
        error,
        scope: 'commerce-orders.services.orders',
      })
    );
    throw postOrderErr;
  }

  const newOrderVerificationId = savedVerification._id;

  // 12 & 13. Send confirmation email + WhatsApp notification in parallel (both non-fatal).
  // Running sequentially risks cutt.ly(3s) + SMTP(4s) + WhatsApp(4s) = 11s > Lambda 10s limit.
  await Promise.all([
    sendOrderEmail(
      email,
      `PTag 訂單資料：${tempId}`,
      {
        lastName, phoneNumber, address, email, option, type, tempId,
        petImg: petImgUrl, paymentWay, shopCode, delivery, price: finalPrice,
        deliveryFee, promotionCode, petContact, petName, optionColor, optionSize, isPTagAir,
      },
      'support@ptag.com.hk',
      newOrderVerificationId
    ).catch((error) => logWarn('Order confirmation email dispatch failed', { event: ctx.event, error, scope: 'commerce-orders.services.orders' })),
    sendWhatsAppOrderMessage(
      { phoneNumber, lastName, option, tempId, lang },
      newOrderVerificationId
    ).catch((error) => logWarn('WhatsApp order notification dispatch failed', { event: ctx.event, error, scope: 'commerce-orders.services.orders' })),
  ]);

return response.successResponse(200, ctx.event, {
  message: 'success.created',
  data: { id: String(newOrderVerificationId), purchaseCode: tempId, price: finalPrice },
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
  const tempParam = parsePathParam(ctx.event.pathParameters?.['tempId'], tempIdString());
  if (!tempParam.ok) {
    return response.errorResponse(tempParam.statusCode, tempParam.errorKey, ctx.event);
  }
  const tempId = tempParam.data;

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
    message: 'success.retrieved',
    data: { 
      id: String(safeOrder['_id']), 
      petContact: safeOrder['petContact'] as string | undefined,
      sfWayBillNumber: safeOrder['sfWayBillNumber'] as string | undefined
    },
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

  const queryParams = ctx.event.queryStringParameters ?? {};
  const pagination = paginationQuerySchema().safeParse(queryParams);
  if (!pagination.success) {
    return response.errorResponse(400, 'common.invalidQueryParams', ctx.event);
  }
  const { page, limit } = pagination.data;
  const skip = (page - 1) * limit;

  const search = typeof queryParams.search === 'string' ? queryParams.search.trim() : '';
  const sortByAllowlist = new Set([
    'updatedAt',
    'createdAt',
    'tagId',
    'staffVerification',
    'cancelled',
    'verifyDate',
    'tagCreationDate',
    'petName',
    'masterEmail',
    'orderId',
    'location',
    'petHuman',
    'pendingStatus',
    'option',
    'type',
    'optionSize',
    'optionColor',
    'price',
  ]);
  const sortBy = sortByAllowlist.has(String(queryParams.sortBy)) ? String(queryParams.sortBy) : 'updatedAt';
  const sortOrder = String(queryParams.sortOrder || 'desc').toLowerCase() === 'asc' ? 1 : -1;

  const filter: Record<string, unknown> = { cancelled: { $exists: true } };
  if (search) {
    const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { tagId: { $regex: safeSearch, $options: 'i' } },
      { contact: { $regex: safeSearch, $options: 'i' } },
      { petName: { $regex: safeSearch, $options: 'i' } },
      { masterEmail: { $regex: safeSearch, $options: 'i' } },
      { orderId: { $regex: safeSearch, $options: 'i' } },
      { location: { $regex: safeSearch, $options: 'i' } },
      { petHuman: { $regex: safeSearch, $options: 'i' } },
      { option: { $regex: safeSearch, $options: 'i' } },
      { type: { $regex: safeSearch, $options: 'i' } },
      { optionSize: { $regex: safeSearch, $options: 'i' } },
      { optionColor: { $regex: safeSearch, $options: 'i' } },
    ];
  }

  const selectFields =
    '_id tagId staffVerification contact verifyDate tagCreationDate petName shortUrl ' +
    'masterEmail qrUrl petUrl orderId location petHuman createdAt updatedAt ' +
    'pendingStatus option type optionSize optionColor price cancelled';

  const [allOrders, total] = await Promise.all([
    (OrderVerification
      .find(filter)
      .select(selectFields)
      .sort({ [sortBy]: sortOrder, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean()) as Promise<Record<string, unknown>[]>,
    OrderVerification.countDocuments(filter),
  ]);

  return response.successResponse(200, ctx.event, {
    message: 'success.retrieved',
    data: allOrders.map(sanitizeOrderVerification),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}
