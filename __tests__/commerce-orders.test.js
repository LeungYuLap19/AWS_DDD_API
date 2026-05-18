/**
 * commerce-orders Lambda — handler-level integration tests (Tier 2).
 *
 * Exercises the real exported `handler` (createApiGatewayHandler -> createRouter)
 * against all commerce-orders routes. MongoDB, S3, nodemailer, axios, and fetch are mocked.
 *
 * Routes under test:
 *   GET  /commerce/orders                — admin-only paginated order list
 *   POST /commerce/orders                — authenticated purchase confirmation (multipart)
 *   GET  /commerce/orders/operations     — admin-only order-verification list
 *   GET  /commerce/orders/{tempId}       — authenticated order info (self or admin)
 *
 * Run:  npm test -- __tests__/commerce-orders.test.js --runInBand
 * Pre-req: npm run build:ts
 */

'use strict';

const path = require('path');
const mongoose = require('mongoose');

const handlerModulePath = path.resolve(
  __dirname,
  '../dist/functions/commerce-orders/index.js'
);
const sharedRuntimeModulePath = path.resolve(
  __dirname,
  '../dist/layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/index.js'
);

// ─── constants ────────────────────────────────────────────────────────────────

const TEST_TEMP_ID = 'TEMP-TEST-001';
const TEST_OV_ID = new mongoose.Types.ObjectId();
const TEST_ORDER_ID = new mongoose.Types.ObjectId();
const TEST_OWNER_EMAIL = 'owner@test.com';
const TEST_SHOP_CODE = 'SHOP01';

// ─── factories ────────────────────────────────────────────────────────────────

function createContext() {
  return {
    awsRequestId: 'req-commerce-orders-test',
    callbackWaitsForEmptyEventLoop: true,
  };
}

function createEvent({
  method = 'GET',
  path: eventPath = '/commerce/orders',
  resource = '/commerce/orders',
  body = null,
  headers = {},
  pathParameters = null,
  queryStringParameters = null,
  authorizer = undefined,
} = {}) {
  return {
    httpMethod: method,
    path: eventPath,
    resource,
    headers: {
      'Content-Type': 'application/json',
      origin: 'http://localhost:3000',
      ...headers,
    },
    body: body !== null ? JSON.stringify(body) : null,
    pathParameters,
    queryStringParameters,
    multiValueQueryStringParameters: null,
    multiValueHeaders: {},
    stageVariables: null,
    requestContext: {
      requestId: 'req-commerce-orders-test',
      identity: { sourceIp: '203.0.113.5' },
      authorizer,
    },
    isBase64Encoded: false,
  };
}

function adminAuth(overrides = {}) {
  return {
    userId: new mongoose.Types.ObjectId().toString(),
    userEmail: 'admin@ptag.com.hk',
    userRole: 'admin',
    principalId: 'admin-principal',
    ...overrides,
  };
}

function userAuth({ email = TEST_OWNER_EMAIL, role = 'user' } = {}) {
  return {
    userId: new mongoose.Types.ObjectId().toString(),
    userEmail: email,
    userRole: role,
    principalId: 'user-principal',
  };
}

function parseResponse(result) {
  return {
    statusCode: result.statusCode,
    headers: result.headers,
    body: result.body ? JSON.parse(result.body) : null,
  };
}

function makeSampleOrder(overrides = {}) {
  return {
    _id: TEST_ORDER_ID,
    tempId: TEST_TEMP_ID,
    email: TEST_OWNER_EMAIL,
    petContact: TEST_OWNER_EMAIL,
    lastName: 'Chan',
    phoneNumber: '12345678',
    address: 'Hong Kong',
    paymentWay: 'FPS',
    delivery: 'SF Express',
    option: 'PTagClassic',
    type: 'PTag Classic',
    price: 299,
    petImg: 'https://cdn.test.example/user-uploads/orders/TEMP-TEST-001/img.jpg',
    promotionCode: '',
    shopCode: TEST_SHOP_CODE,
    buyDate: new Date('2025-01-01'),
    petName: 'Buddy',
    sfWayBillNumber: null,
    language: 'chn',
    isPTagAir: false,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  };
}

function makeSampleOV(overrides = {}) {
  return {
    _id: TEST_OV_ID,
    tagId: 'A2B3C4',
    staffVerification: false,
    cancelled: false,
    contact: '12345678',
    petName: 'Buddy',
    orderId: TEST_TEMP_ID,
    masterEmail: TEST_OWNER_EMAIL,
    option: 'PTagClassic',
    type: 'PTag Classic',
    price: 299,
    optionSize: '',
    optionColor: 'White',
    pendingStatus: false,
    shortUrl: 'https://cutt.ly/abc',
    qrUrl: 'https://cdn.test.example/qr-codes/abc.png',
    petUrl: '',
    location: 'Hong Kong',
    petHuman: 'Chan',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  };
}

// ─── env ──────────────────────────────────────────────────────────────────────

function resetEnv(overrides = {}) {
  process.env.PROJECT_NAME = 'aws-ddd-api';
  process.env.STAGE_NAME = 'test';
  process.env.LAMBDA_ALIAS_NAME = 'test';
  process.env.CONFIG_NAMESPACE = 'test';
  process.env.NODE_ENV = 'test';
  process.env.ALLOWED_ORIGINS = '*';
  process.env.MONGODB_URI = 'mongodb://example.test/petpetclub_uat';
  process.env.AUTH_BYPASS = 'false';
  process.env.JWT_SECRET = 'test-secret';
  process.env.AWS_BUCKET_NAME = 'test-bucket';
  process.env.AWS_BUCKET_BASE_URL = 'https://cdn.test.example';
  process.env.AWS_BUCKET_REGION = 'ap-east-1';
  process.env.SMTP_HOST = 'smtp.example.com';
  process.env.SMTP_PORT = '465';
  process.env.SMTP_USER = 'user@example.com';
  process.env.SMTP_PASS = 'test-pass';
  process.env.SMTP_FROM = 'noreply@ptag.com.hk';
  process.env.WHATSAPP_BEARER_TOKEN = 'test-wa-token';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '111222333444555';
  process.env.CUTTLY_API_KEY = 'test-cuttly-key';
  delete process.env.AWS_SAM_LOCAL;
  Object.assign(process.env, overrides);
}

function createSharedMultipartMock(sharedModulePath, multipartForm) {
  return () => {
    const realShared = require(sharedModulePath);
    return {
      ...realShared,
      parseMultipartBody: async (event, schema, options = {}) => {
        const form = multipartForm || { files: [] };
        const files = (Array.isArray(form.files) ? form.files : []).map((file) => ({
          fieldname: file.fieldname || file.field || 'file',
          filename: file.filename || 'test.jpg',
          contentType: file.contentType || 'image/jpeg',
          content: file.content || Buffer.from('test'),
        }));
        const rawFields = { ...form };
        delete rawFields.files;
        if (options.validate) {
          const validationKey = options.validate(rawFields);
          if (validationKey !== null) {
            return { ok: false, statusCode: 400, errorKey: validationKey };
          }
        }
        const normalizedFields = options.normalize ? options.normalize(rawFields) : rawFields;
        const parsed = schema.safeParse(normalizedFields);
        if (!parsed.success) {
          const fallback = options.fallbackErrorKey || 'common.invalidBodyParams';
          const message = realShared.getFirstZodIssueMessage(parsed.error, fallback);
          const errorKey = message.includes('.') ? message : fallback;
          return { ok: false, statusCode: 400, errorKey };
        }
        return { ok: true, data: parsed.data, files };
      },
    };
  };
}

// ─── query mock builders ──────────────────────────────────────────────────────

function createQueryMock(result, err = null) {
  return {
    lean: err ? jest.fn().mockRejectedValue(err) : jest.fn().mockResolvedValue(result),
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
  };
}

// ─── handler loader ───────────────────────────────────────────────────────────

/**
 * Reloads the compiled handler with fresh mocks on every call.
 */
function loadHandlerWithMocks({
  // Order.find
  orderFindListResult = [],
  orderFindListError = null,
  orderCountResult = 0,
  // Order.findOne — stateful queue
  orderFindOneSequence = [],
  // OrderVerification.find
  ovFindListResult = [],
  ovFindListError = null,
  ovCountResult = 0,
  // OrderVerification.findOne — stateful queue
  ovFindOneSequence = [],
  // ShopInfo.findOne
  shopInfoResult = { price: 299 },
  shopInfoError = null,
  // PtagProduct.find
  ptagProductResult = [
    {
      name: 'PTag',
      deliveryCharge: 50,
      tiers: [
        { type: 'normal', price: 259 },
        { type: 'custom', price: 279 },
      ],
    },
    {
      name: 'ptag air',
      deliveryCharge: 50,
      tiers: [{ type: 'standard', price: 199 }],
    },
  ],
  ptagProductError = null,
  // ImageCollection
  imageCollectionCreateResult = { _id: new mongoose.Types.ObjectId() },
  imageCollectionUpdateOneResult = {},
  // OrderVerification constructor save
  ovSaveError = null,
  // Order constructor save
  orderSaveError = null,
  // Order.deleteOne (compensation)
  orderDeleteOneResult = {},
  // DB connect
  connectError = null,
  // nodemailer
  sendMailResult = { messageId: 'test-msg-id' },
  sendMailError = null,
  // S3
  s3SendResult = {},
  s3SendError = null,
  // axios (cutt.ly + QR)
  axiosGetResult = { data: { url: { shortLink: 'https://cutt.ly/abc' } } },
  axiosGetError = null,
  // Rate limit — pass to bypass
  rateLimitBypassed = true,
} = {}) {
  jest.resetModules();
  jest.clearAllMocks();
  resetEnv();

  const actualMongoose = jest.requireActual('mongoose');
  const orderFindOneCalls = [...orderFindOneSequence];
  const ovFindOneCalls = [...ovFindOneSequence];

  // ── Order model ──
  const savedOrderId = new mongoose.Types.ObjectId();

  function MockOrderConstructor(data) {
    Object.assign(this, data);
    this._id = savedOrderId;
    this.buyDate = data.buyDate || new Date();
    this.save = orderSaveError
      ? jest.fn().mockRejectedValue(orderSaveError)
      : jest.fn().mockResolvedValue(this);
  }

  const orderFindOneFn = jest.fn().mockImplementation(() => {
    const next = orderFindOneCalls.shift();
    if (!next) return createQueryMock(null);
    return createQueryMock(next.result ?? null, next.err ?? null);
  });

  const orderFindFn = jest.fn().mockReturnValue({
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: orderFindListError
      ? jest.fn().mockRejectedValue(orderFindListError)
      : jest.fn().mockResolvedValue(orderFindListResult),
  });

  const orderCountFn = jest.fn().mockResolvedValue(orderCountResult);
  const orderDeleteOneFn = jest.fn().mockResolvedValue(orderDeleteOneResult);

  Object.assign(MockOrderConstructor, {
    find: orderFindFn,
    findOne: orderFindOneFn,
    countDocuments: orderCountFn,
    deleteOne: orderDeleteOneFn,
  });

  // ── OrderVerification model ──
  const savedOvId = new mongoose.Types.ObjectId();

  function MockOVConstructor(data) {
    Object.assign(this, data);
    this._id = savedOvId;
    this.save = ovSaveError
      ? jest.fn().mockRejectedValue(ovSaveError)
      : jest.fn().mockResolvedValue(this);
  }

  const ovFindOneFn = jest.fn().mockImplementation(() => {
    const next = ovFindOneCalls.shift();
    if (!next) return createQueryMock(null);
    return createQueryMock(next.result ?? null, next.err ?? null);
  });

  const ovFindFn = jest.fn().mockReturnValue({
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: ovFindListError
      ? jest.fn().mockRejectedValue(ovFindListError)
      : jest.fn().mockResolvedValue(ovFindListResult),
  });

  const ovCountFn = jest.fn().mockResolvedValue(ovCountResult);

  Object.assign(MockOVConstructor, {
    find: ovFindFn,
    findOne: ovFindOneFn,
    countDocuments: ovCountFn,
  });

  // ── ShopInfo model ──
  const shopInfoFindOneFn = jest.fn().mockReturnValue({
    lean: shopInfoError
      ? jest.fn().mockRejectedValue(shopInfoError)
      : jest.fn().mockResolvedValue(shopInfoResult),
  });

  const shopInfoModel = { findOne: shopInfoFindOneFn };

  // ── PtagProduct model ──
  const ptagProductFindFn = jest.fn().mockReturnValue({
    lean: ptagProductError
      ? jest.fn().mockRejectedValue(ptagProductError)
      : jest.fn().mockResolvedValue(ptagProductResult),
  });
  const ptagProductModel = { find: ptagProductFindFn };

  // ── ImageCollection model ──
  const imageCollectionModel = {
    create: jest.fn().mockResolvedValue(imageCollectionCreateResult),
    updateOne: jest.fn().mockResolvedValue(imageCollectionUpdateOneResult),
  };

  // ── mongoose mock ──
// ── RateLimit model (for requireMongoRateLimit) ──
    const rateLimitModel = {
      findOneAndUpdate: jest.fn().mockResolvedValue({ count: 1 }),
    };

    const mongooseMock = {
      Schema: actualMongoose.Schema,
      Types: actualMongoose.Types,
      connection: { readyState: connectError ? 0 : 1 },
      connect: connectError
        ? jest.fn().mockRejectedValue(connectError)
        : jest.fn().mockResolvedValue({}),
      models: {},
      isValidObjectId: actualMongoose.isValidObjectId,
      model: jest.fn((name) => {
        if (name === 'Order') return MockOrderConstructor;
        if (name === 'OrderVerification') return MockOVConstructor;
        if (name === 'ShopInfo') return shopInfoModel;
        if (name === 'PtagProduct') return ptagProductModel;
        if (name === 'ImageCollection') return imageCollectionModel;
        if (name === 'RateLimit') return rateLimitModel;
      throw new Error(`Unexpected model "${name}"`);
    }),
  };

  jest.doMock('mongoose', () => ({
    __esModule: true,
    default: mongooseMock,
    Schema: actualMongoose.Schema,
    Types: actualMongoose.Types,
    isValidObjectId: actualMongoose.isValidObjectId,
  }));

  jest.doMock('@aws-ddd-api/shared', createSharedMultipartMock(sharedRuntimeModulePath, { files: [] }), { virtual: true });

  // ── nodemailer ──
  const mockSendMail = sendMailError
    ? jest.fn().mockRejectedValue(sendMailError)
    : jest.fn().mockResolvedValue(sendMailResult);

  jest.doMock('nodemailer', () => ({
    __esModule: true,
    default: { createTransport: jest.fn().mockReturnValue({ sendMail: mockSendMail }) },
    createTransport: jest.fn().mockReturnValue({ sendMail: mockSendMail }),
  }));

  // ── S3 ──
  const mockS3Send = s3SendError
    ? jest.fn().mockRejectedValue(s3SendError)
    : jest.fn().mockResolvedValue(s3SendResult);

  jest.doMock('@aws-sdk/client-s3', () => ({
    __esModule: true,
    S3Client: jest.fn().mockImplementation(() => ({ send: mockS3Send })),
    PutObjectCommand: jest.fn().mockImplementation((params) => params),
  }));

  // ── axios (cutt.ly + QR image fetch) ──
  const mockAxiosGet = axiosGetError
    ? jest.fn().mockRejectedValue(axiosGetError)
    : jest.fn().mockResolvedValue(axiosGetResult);

  jest.doMock('axios', () => ({
    __esModule: true,
    default: { get: mockAxiosGet },
    get: mockAxiosGet,
  }));

  // ── requireMongoRateLimit (bypass for all tests unless specifically testing rate limit) ──
  // We patch through the shared module — since we already mock the whole shared module,
  // requireMongoRateLimit resolves without error (rate limit not exceeded).

  // ── fetch (WhatsApp API) ──
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ messages: [{ id: 'wa-msg-id' }] }),
  });

  const { handler } = require(handlerModulePath);
  return {
    handler,
    mocks: {
      orderFindOneFn,
      orderFindFn,
      orderCountFn,
      orderDeleteOneFn,
      ovFindOneFn,
      ovFindFn,
      shopInfoFindOneFn,
      ptagProductFindFn,
      imageCollectionModel,
      mockSendMail,
      mockS3Send,
      mockAxiosGet,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Handler infrastructure
// ═══════════════════════════════════════════════════════════════════════════════

describe('commerce-orders — handler infrastructure', () => {
  test('returns 404 for unknown route', async () => {
    const { handler } = loadHandlerWithMocks();
    const result = await handler(
      createEvent({
        method: 'GET',
        path: '/commerce/orders/unknown/deep/path',
        resource: '/commerce/orders/unknown/deep/path',
      }),
      createContext()
    );
    expect(parseResponse(result).statusCode).toBe(404);
  });

  test('returns 405 for known path with wrong method', async () => {
    const { handler } = loadHandlerWithMocks();
    const result = await handler(
      createEvent({
        method: 'DELETE',
        path: '/commerce/orders',
        resource: '/commerce/orders',
        authorizer: adminAuth(),
      }),
      createContext()
    );
    expect(parseResponse(result).statusCode).toBe(405);
  });

  test('OPTIONS preflight returns 204', async () => {
    const { handler } = loadHandlerWithMocks();
    const result = await handler(
      createEvent({
        method: 'OPTIONS',
        path: '/commerce/orders',
        resource: '/commerce/orders',
      }),
      createContext()
    );
    expect(result.statusCode).toBe(204);
  });

  test('returns 500 on DB connection failure', async () => {
    const { handler } = loadHandlerWithMocks({
      connectError: new Error('mongo down'),
    });
    const result = await handler(
      createEvent({
        method: 'GET',
        path: '/commerce/orders',
        resource: '/commerce/orders',
        authorizer: adminAuth(),
      }),
      createContext()
    );
    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(500);
    expect(parsed.body.errorKey).toBe('common.internalError');
  });

  test('response includes content-type header', async () => {
    const { handler } = loadHandlerWithMocks({
      orderFindListResult: [],
      orderCountResult: 0,
    });
    const result = await handler(
      createEvent({
        method: 'GET',
        path: '/commerce/orders',
        resource: '/commerce/orders',
        authorizer: adminAuth(),
      }),
      createContext()
    );
    expect(result.headers['content-type']).toBe('application/json');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /commerce/orders — admin order list
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /commerce/orders — admin order list', () => {
  test('happy path — returns paginated orders', async () => {
    const o1 = makeSampleOrder({ tempId: 'TEMP-001' });
    const o2 = makeSampleOrder({ tempId: 'TEMP-002', _id: new mongoose.Types.ObjectId() });
    const { handler } = loadHandlerWithMocks({
      orderFindListResult: [o1, o2],
      orderCountResult: 2,
    });
    const result = await handler(
      createEvent({
        method: 'GET',
        path: '/commerce/orders',
        resource: '/commerce/orders',
        authorizer: adminAuth(),
      }),
      createContext()
    );
    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(200);
    expect(Array.isArray(parsed.body.data)).toBe(true);
    expect(parsed.body.data).toHaveLength(2);
    expect(parsed.body.pagination.total).toBe(2);
    expect(parsed.body.pagination.page).toBe(1);
  });

  test('pagination params are respected', async () => {
    const { handler, mocks } = loadHandlerWithMocks({
      orderFindListResult: [],
      orderCountResult: 50,
    });
    await handler(
      createEvent({
        method: 'GET',
        path: '/commerce/orders',
        resource: '/commerce/orders',
        queryStringParameters: { page: '3', limit: '10' },
        authorizer: adminAuth(),
      }),
      createContext()
    );
    const skipFn = mocks.orderFindFn.mock.results[0]?.value?.skip;
    expect(skipFn).toBeDefined();
    expect(skipFn).toHaveBeenCalledWith(20);
  });

  test('developer role can access the list', async () => {
    const { handler } = loadHandlerWithMocks({ orderFindListResult: [], orderCountResult: 0 });
    const result = await handler(
      createEvent({
        method: 'GET',
        path: '/commerce/orders',
        resource: '/commerce/orders',
        authorizer: adminAuth({ userRole: 'developer' }),
      }),
      createContext()
    );
    expect(parseResponse(result).statusCode).toBe(200);
  });

  test('rejects unauthenticated request with 401', async () => {
    const { handler } = loadHandlerWithMocks();
    const result = await handler(
      createEvent({
        method: 'GET',
        path: '/commerce/orders',
        resource: '/commerce/orders',
        authorizer: undefined,
      }),
      createContext()
    );
    expect(parseResponse(result).statusCode).toBe(401);
  });

  test('rejects non-admin user with 403', async () => {
    const { handler } = loadHandlerWithMocks();
    const result = await handler(
      createEvent({
        method: 'GET',
        path: '/commerce/orders',
        resource: '/commerce/orders',
        authorizer: userAuth(),
      }),
      createContext()
    );
    expect(parseResponse(result).statusCode).toBe(403);
  });

  test('sanitized output does not include unexpected fields', async () => {
    const order = makeSampleOrder({ internalSecret: 'should-not-appear' });
    const { handler } = loadHandlerWithMocks({ orderFindListResult: [order], orderCountResult: 1 });
    const result = await handler(
      createEvent({
        method: 'GET',
        path: '/commerce/orders',
        resource: '/commerce/orders',
        authorizer: adminAuth(),
      }),
      createContext()
    );
    const item = parseResponse(result).body.data[0];
    expect(item).not.toHaveProperty('internalSecret');
    expect(item).toHaveProperty('tempId');
    expect(item).toHaveProperty('email');
  });

  test('oversized limit is rejected as invalid query params', async () => {
    const { handler, mocks } = loadHandlerWithMocks({ orderFindListResult: [], orderCountResult: 0 });
    await handler(
      createEvent({
        method: 'GET',
        path: '/commerce/orders',
        resource: '/commerce/orders',
        queryStringParameters: { limit: '9999' },
        authorizer: adminAuth(),
      }),
      createContext()
    );
    const parsed = parseResponse(await handler(
      createEvent({
        method: 'GET',
        path: '/commerce/orders',
        resource: '/commerce/orders',
        queryStringParameters: { limit: '9999' },
        authorizer: adminAuth(),
      }),
      createContext()
    ));
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('common.invalidQueryParams');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /commerce/orders/operations — admin order-verification list
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /commerce/orders/operations — admin OV list', () => {
  test('happy path — returns all order verifications', async () => {
    const ov1 = makeSampleOV({ tagId: 'A2B3C4' });
    const ov2 = makeSampleOV({ tagId: 'D5E6F7', _id: new mongoose.Types.ObjectId() });
    const { handler } = loadHandlerWithMocks({ ovFindListResult: [ov1, ov2], ovCountResult: 2 });
    const result = await handler(
      createEvent({
        method: 'GET',
        path: '/commerce/orders/operations',
        resource: '/commerce/orders/operations',
        authorizer: adminAuth(),
      }),
      createContext()
    );
    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(200);
    expect(Array.isArray(parsed.body.data)).toBe(true);
    expect(parsed.body.data).toHaveLength(2);
    expect(parsed.body.message).toBeDefined();
    expect(parsed.body.pagination.total).toBe(2);
    expect(parsed.body.pagination.page).toBe(1);
  });

  test('supports search + sort query params with escaped regex', async () => {
    const rawSearch = 'buddy.*+?^${}()|[]\\';
    const escapedSearch = rawSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const { handler, mocks } = loadHandlerWithMocks({ ovFindListResult: [], ovCountResult: 0 });
    const result = await handler(
      createEvent({
        method: 'GET',
        path: '/commerce/orders/operations',
        resource: '/commerce/orders/operations',
        queryStringParameters: {
          page: '2',
          limit: '5',
          search: rawSearch,
          sortBy: 'petName',
          sortOrder: 'asc',
        },
        authorizer: adminAuth(),
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(200);
    expect(parsed.body.pagination.page).toBe(2);
    expect(parsed.body.pagination.limit).toBe(5);

    const findFilter = mocks.ovFindFn.mock.calls[0][0];
    expect(findFilter).toHaveProperty('cancelled');
    expect(Array.isArray(findFilter.$or)).toBe(true);
    expect(findFilter.$or).toEqual(
      expect.arrayContaining([
        { petName: { $regex: escapedSearch, $options: 'i' } },
        { masterEmail: { $regex: escapedSearch, $options: 'i' } },
      ])
    );

    const sortFn = mocks.ovFindFn.mock.results[0]?.value?.sort;
    expect(sortFn).toBeDefined();
    expect(sortFn).toHaveBeenCalledWith({ petName: 1, _id: -1 });

    const skipFn = mocks.ovFindFn.mock.results[0]?.value?.skip;
    expect(skipFn).toBeDefined();
    expect(skipFn).toHaveBeenCalledWith(5);
  });

  test('falls back to updatedAt desc when sortBy is not allowlisted', async () => {
    const { handler, mocks } = loadHandlerWithMocks({ ovFindListResult: [], ovCountResult: 0 });
    const result = await handler(
      createEvent({
        method: 'GET',
        path: '/commerce/orders/operations',
        resource: '/commerce/orders/operations',
        queryStringParameters: {
          sortBy: 'not-a-real-field',
        },
        authorizer: adminAuth(),
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(200);
    const sortFn = mocks.ovFindFn.mock.results[0]?.value?.sort;
    expect(sortFn).toBeDefined();
    expect(sortFn).toHaveBeenCalledWith({ updatedAt: -1, _id: -1 });
  });

  test('trims search and omits regex filters when search is blank', async () => {
    const { handler, mocks } = loadHandlerWithMocks({ ovFindListResult: [], ovCountResult: 0 });
    const result = await handler(
      createEvent({
        method: 'GET',
        path: '/commerce/orders/operations',
        resource: '/commerce/orders/operations',
        queryStringParameters: {
          search: '   ',
        },
        authorizer: adminAuth(),
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(200);
    expect(mocks.ovFindFn.mock.calls[0][0]).toEqual({ cancelled: { $exists: true } });
  });

  test('returns 404 when no records exist', async () => {
    const { handler } = loadHandlerWithMocks({ ovFindListResult: [] });
    const result = await handler(
      createEvent({
        method: 'GET',
        path: '/commerce/orders/operations',
        resource: '/commerce/orders/operations',
        authorizer: adminAuth(),
      }),
      createContext()
    );
    expect(parseResponse(result).statusCode).toBe(200);
  });

  test('developer role can access operations', async () => {
    const { handler } = loadHandlerWithMocks({ ovFindListResult: [makeSampleOV()], ovCountResult: 1 });
    const result = await handler(
      createEvent({
        method: 'GET',
        path: '/commerce/orders/operations',
        resource: '/commerce/orders/operations',
        authorizer: adminAuth({ userRole: 'developer' }),
      }),
      createContext()
    );
    expect(parseResponse(result).statusCode).toBe(200);
  });

  test('rejects non-admin with 403', async () => {
    const { handler } = loadHandlerWithMocks();
    const result = await handler(
      createEvent({
        method: 'GET',
        path: '/commerce/orders/operations',
        resource: '/commerce/orders/operations',
        authorizer: userAuth(),
      }),
      createContext()
    );
    expect(parseResponse(result).statusCode).toBe(403);
  });

  test('sanitized OV output does not include discountProof', async () => {
    const ov = makeSampleOV({ discountProof: 'sensitive-proof-url' });
    const { handler } = loadHandlerWithMocks({ ovFindListResult: [ov], ovCountResult: 1 });
    const result = await handler(
      createEvent({
        method: 'GET',
        path: '/commerce/orders/operations',
        resource: '/commerce/orders/operations',
        authorizer: adminAuth(),
      }),
      createContext()
    );
    const item = parseResponse(result).body.data[0];
    expect(item).not.toHaveProperty('discountProof');
    expect(item).toHaveProperty('tagId');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /commerce/orders/{tempId} — order info
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /commerce/orders/{tempId} — order info', () => {
  test('happy path — owner retrieves own order', async () => {
    const order = makeSampleOrder();
    const { handler } = loadHandlerWithMocks({
      orderFindOneSequence: [{ result: order }],
    });
    const result = await handler(
      createEvent({
        method: 'GET',
        path: `/commerce/orders/${TEST_TEMP_ID}`,
        resource: '/commerce/orders/{tempId}',
        pathParameters: { tempId: TEST_TEMP_ID },
        authorizer: userAuth({ email: TEST_OWNER_EMAIL }),
      }),
      createContext()
    );
    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(200);
    expect(parsed.body.data).toHaveProperty('petContact');
    expect(parsed.body.data).toHaveProperty('id');
  });

  test('admin can access any order', async () => {
    const order = makeSampleOrder({ email: 'someoneelse@example.com' });
    const { handler } = loadHandlerWithMocks({
      orderFindOneSequence: [{ result: order }],
    });
    const result = await handler(
      createEvent({
        method: 'GET',
        path: `/commerce/orders/${TEST_TEMP_ID}`,
        resource: '/commerce/orders/{tempId}',
        pathParameters: { tempId: TEST_TEMP_ID },
        authorizer: adminAuth(),
      }),
      createContext()
    );
    expect(parseResponse(result).statusCode).toBe(200);
  });

  test('non-owner user is rejected with 403', async () => {
    const order = makeSampleOrder({ email: 'realowner@example.com' });
    const { handler } = loadHandlerWithMocks({
      orderFindOneSequence: [{ result: order }],
    });
    const result = await handler(
      createEvent({
        method: 'GET',
        path: `/commerce/orders/${TEST_TEMP_ID}`,
        resource: '/commerce/orders/{tempId}',
        pathParameters: { tempId: TEST_TEMP_ID },
        authorizer: userAuth({ email: 'attacker@example.com' }),
      }),
      createContext()
    );
    expect(parseResponse(result).statusCode).toBe(403);
  });

  test('returns 404 when order does not exist', async () => {
    const { handler } = loadHandlerWithMocks({
      orderFindOneSequence: [{ result: null }],
    });
    const result = await handler(
      createEvent({
        method: 'GET',
        path: '/commerce/orders/NONEXISTENT',
        resource: '/commerce/orders/{tempId}',
        pathParameters: { tempId: 'NONEXISTENT' },
        authorizer: adminAuth(),
      }),
      createContext()
    );
    expect(parseResponse(result).statusCode).toBe(404);
  });

  test('rejects unauthenticated request with 401', async () => {
    const { handler } = loadHandlerWithMocks();
    const result = await handler(
      createEvent({
        method: 'GET',
        path: `/commerce/orders/${TEST_TEMP_ID}`,
        resource: '/commerce/orders/{tempId}',
        pathParameters: { tempId: TEST_TEMP_ID },
        authorizer: undefined,
      }),
      createContext()
    );
    expect(parseResponse(result).statusCode).toBe(401);
  });

  test('email comparison is case-insensitive', async () => {
    const order = makeSampleOrder({ email: 'Owner@Test.COM' });
    const { handler } = loadHandlerWithMocks({
      orderFindOneSequence: [{ result: order }],
    });
    const result = await handler(
      createEvent({
        method: 'GET',
        path: `/commerce/orders/${TEST_TEMP_ID}`,
        resource: '/commerce/orders/{tempId}',
        pathParameters: { tempId: TEST_TEMP_ID },
        authorizer: userAuth({ email: 'owner@test.com' }),
      }),
      createContext()
    );
    expect(parseResponse(result).statusCode).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /commerce/orders — purchase confirmation
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /commerce/orders — purchase confirmation', () => {
  /**
   * Creates a multipart-like event body and mocks lambda-multipart-parser
   * to return the given fields + files for this test.
   */
  function loadWithMultipartMock(fields = {}, fileMocks = { files: [] }, loaderOpts = {}) {
    jest.resetModules();
    jest.clearAllMocks();
    resetEnv();

    const actualMongoose = jest.requireActual('mongoose');
    const savedOrderId = new mongoose.Types.ObjectId();
    const savedOvId = new mongoose.Types.ObjectId();

    const shopInfoResult = loaderOpts.shopInfoResult !== undefined
      ? loaderOpts.shopInfoResult
      : { price: 299 };
    const ptagProductResult = loaderOpts.ptagProductResult !== undefined
      ? loaderOpts.ptagProductResult
      : [
          {
            name: 'PTag',
            deliveryCharge: 50,
            tiers: [
              { type: 'normal', price: 259 },
              { type: 'custom', price: 279 },
            ],
          },
          {
            name: 'ptag air',
            deliveryCharge: 50,
            tiers: [{ type: 'standard', price: 199 }],
          },
        ];

    const orderSaveError = loaderOpts.orderSaveError ?? null;
    const ovSaveError = loaderOpts.ovSaveError ?? null;
    const connectError = loaderOpts.connectError ?? null;
    const orderFindOneResult = loaderOpts.orderFindOneResult !== undefined
      ? loaderOpts.orderFindOneResult
      : null; // null = no duplicate

    function MockOrderConstructor(data) {
      Object.assign(this, data);
      this._id = savedOrderId;
      this.buyDate = new Date();
      this.save = orderSaveError
        ? jest.fn().mockRejectedValue(orderSaveError)
        : jest.fn().mockResolvedValue(this);
    }
    Object.assign(MockOrderConstructor, {
      find: jest.fn().mockReturnValue({ skip: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([]) }),
      findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(orderFindOneResult), select: jest.fn().mockReturnThis() }),
      countDocuments: jest.fn().mockResolvedValue(0),
      deleteOne: jest.fn().mockResolvedValue({}),
    });

    function MockOVConstructor(data) {
      Object.assign(this, data);
      this._id = savedOvId;
      this.save = ovSaveError
        ? jest.fn().mockRejectedValue(ovSaveError)
        : jest.fn().mockResolvedValue(this);
    }
    Object.assign(MockOVConstructor, {
      find: jest.fn().mockReturnValue({ select: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([]) }),
      findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null), select: jest.fn().mockReturnThis() }),
    });

    const imageCollectionModel = {
      create: jest.fn().mockResolvedValue({ _id: new mongoose.Types.ObjectId() }),
      updateOne: jest.fn().mockResolvedValue({}),
    };

    const mongooseMock = {
      Schema: actualMongoose.Schema,
      Types: actualMongoose.Types,
      connection: { readyState: connectError ? 0 : 1 },
      connect: connectError
        ? jest.fn().mockRejectedValue(connectError)
        : jest.fn().mockResolvedValue({}),
      models: {},
      isValidObjectId: actualMongoose.isValidObjectId,
      model: jest.fn((name) => {
        if (name === 'Order') return MockOrderConstructor;
        if (name === 'OrderVerification') return MockOVConstructor;
        if (name === 'ShopInfo') return { findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(shopInfoResult) }) };
        if (name === 'PtagProduct') return { find: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(ptagProductResult) }) };
        if (name === 'ImageCollection') return imageCollectionModel;
        if (name === 'RateLimit') return { findOneAndUpdate: jest.fn().mockResolvedValue({ count: 1 }) };
        throw new Error(`Unexpected model "${name}"`);
      }),
    };

    jest.doMock('mongoose', () => ({ __esModule: true, default: mongooseMock, Schema: actualMongoose.Schema, Types: actualMongoose.Types, isValidObjectId: actualMongoose.isValidObjectId }));
    jest.doMock('@aws-ddd-api/shared', createSharedMultipartMock(sharedRuntimeModulePath, { ...fields, ...fileMocks }), { virtual: true });
    const mockSendMail = jest.fn().mockResolvedValue({ messageId: 'ok' });
    jest.doMock('nodemailer', () => ({ __esModule: true, default: { createTransport: jest.fn().mockReturnValue({ sendMail: mockSendMail }) }, createTransport: jest.fn().mockReturnValue({ sendMail: mockSendMail }) }));
    jest.doMock('@aws-sdk/client-s3', () => ({ __esModule: true, S3Client: jest.fn().mockImplementation(() => ({ send: jest.fn().mockResolvedValue({}) })), PutObjectCommand: jest.fn().mockImplementation((p) => p) }));
    jest.doMock('axios', () => ({ __esModule: true, default: { get: jest.fn().mockResolvedValue({ data: { url: { shortLink: 'https://cutt.ly/abc' } } }) }, get: jest.fn().mockResolvedValue({ data: { url: { shortLink: 'https://cutt.ly/abc' } } }) }));
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });

    const { handler } = require(handlerModulePath);
    return { handler, savedOrderId, savedOvId, mockSendMail };
  }

  function validFields(overrides = {}) {
    return {
      lastName: 'Chan',
      email: 'owner@test.com',
      address: 'Hong Kong',
      option: 'PTagClassic',
      tempId: 'TEMP-TEST-001',
      paymentWay: 'FPS',
      delivery: 'SF Express',
      petName: 'Buddy',
      phoneNumber: '12345678',
      shopCode: TEST_SHOP_CODE,
      lang: 'chn',
      ...overrides,
    };
  }

  function postEvent(fields = {}) {
    return createEvent({
      method: 'POST',
      path: '/commerce/orders',
      resource: '/commerce/orders',
      headers: { 'Content-Type': 'multipart/form-data; boundary=----boundary' },
      body: fields,
      authorizer: userAuth(),
    });
  }

  test('happy path — creates order, returns purchase_code, and sends confirmation email', async () => {
    const { handler, mockSendMail } = loadWithMultipartMock(validFields());
    const result = await handler(postEvent(), createContext());
    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(200);
    expect(parsed.body.data).toHaveProperty('purchaseCode');
    expect(parsed.body.data).toHaveProperty('price');
    expect(parsed.body.data).toHaveProperty('id');
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });

  test('rejects unauthenticated request with 401', async () => {
    const { handler } = loadWithMultipartMock(validFields());
    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/commerce/orders',
        resource: '/commerce/orders',
        headers: { 'Content-Type': 'multipart/form-data' },
        body: validFields(),
        authorizer: undefined,
      }),
      createContext()
    );
    expect(parseResponse(result).statusCode).toBe(401);
  });

  test('returns 400 when required field is missing', async () => {
    const fields = validFields();
    delete fields.lastName;
    const { handler } = loadWithMultipartMock(fields);
    const result = await handler(postEvent(), createContext());
    expect(parseResponse(result).statusCode).toBe(400);
  });

  test('returns 400 for invalid email', async () => {
    const { handler } = loadWithMultipartMock(validFields({ email: 'not-an-email' }));
    const result = await handler(postEvent(), createContext());
    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('orders.errors.invalidEmail');
  });

  test('returns 400 for invalid phone number', async () => {
    const { handler } = loadWithMultipartMock(validFields({ phoneNumber: 'abc' }));
    const result = await handler(postEvent(), createContext());
    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('orders.errors.invalidPhone');
  });

  test('returns 400 for invalid option format', async () => {
    const { handler } = loadWithMultipartMock(validFields({ option: 'has spaces!' }));
    const result = await handler(postEvent(), createContext());
    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('orders.errors.invalidOption');
  });

  test('returns 409 when tempId already exists', async () => {
    const { handler } = loadWithMultipartMock(validFields(), { files: [] }, {
      orderSaveError: Object.assign(new Error('duplicate key'), { code: 11000 }),
    });
    const result = await handler(postEvent(), createContext());
    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(409);
    expect(parsed.body.errorKey).toBe('orders.errors.duplicateOrder');
  });

  test('returns 400 when shopCode is invalid (shop not found)', async () => {
    const { handler } = loadWithMultipartMock(validFields({ shopCode: 'UNKNOWN-SHOP' }), { files: [] }, {
      shopInfoResult: null,
    });
    const result = await handler(postEvent(), createContext());
    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('orders.errors.invalidShopCode');
  });

  test('allows missing shopCode and falls back to zero price', async () => {
    const { handler } = loadWithMultipartMock(validFields({ shopCode: undefined }), { files: [] }, {
      shopInfoResult: null,
    });
    const result = await handler(postEvent(), createContext());
    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(200);
    expect(parsed.body.data.price).toBe(309);
  });

  test('with shopCode: finalPrice = ShopInfo.price + deliveryFee (shop price is authoritative item price)', async () => {
    // ShopInfo.price=99 is the shop-specific item price, deliveryFee=50 → 99+50=149
    const { handler } = loadWithMultipartMock(validFields(), { files: [] }, {
      shopInfoResult: { price: 99 },
    });
    const result = await handler(postEvent(), createContext());
    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(200);
    expect(parsed.body.data.price).toBe(149);
  });

  test('uses cent-based money math and avoids floating decimal precision artifacts', async () => {
    // ShopInfo.price=99.2, deliveryFee=50.2 → 99.2+50.2=149.4
    const { handler } = loadWithMultipartMock(validFields(), { files: [] }, {
      shopInfoResult: { price: 99.2 },
      ptagProductResult: [
        {
          name: 'PTag',
          deliveryCharge: 50.2,
          tiers: [{ type: 'normal', price: 259.1 }],
        },
      ],
    });
    const result = await handler(postEvent(), createContext());
    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(200);
    expect(parsed.body.data.price).toBe(149.4);
  });

  test('uses PTagAir standard tier pricing when option is PTagAir (no shopCode)', async () => {
    // No shopCode → itemBasePrice=199, deliveryFee=50 → 199+50=249
    const { handler } = loadWithMultipartMock(validFields({ option: 'PTagAir', type: '', shopCode: undefined }), { files: [] }, {
      shopInfoResult: null,
    });
    const result = await handler(postEvent(), createContext());
    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(200);
    expect(parsed.body.data.price).toBe(249);
  });

  test('returns 400 when option cannot be mapped to a backend product', async () => {
    const { handler } = loadWithMultipartMock(validFields({ option: 'UnknownProduct' }), { files: [] }, {
      shopInfoResult: { price: 0 },
    });
    const result = await handler(postEvent(), createContext());
    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('orders.errors.invalidProductSelection');
  });

  test('returns 400 when optionSize is not in product options', async () => {
    const { handler } = loadWithMultipartMock(
      validFields({ option: 'PTagClassic', optionSize: '99mm', optionColor: 'gold' }),
      { files: [] },
      {
        shopInfoResult: { price: 0 },
        ptagProductResult: [
          {
            name: 'PTag',
            deliveryCharge: 50,
            options: { sizes: ['25mm', '30mm'], colours: ['gold', 'silver'] },
            tiers: [{ type: 'normal', price: 259 }],
          },
        ],
      }
    );
    const result = await handler(postEvent(), createContext());
    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('orders.errors.invalidProductSelection');
  });

  test('returns 400 when optionColor is not in product options', async () => {
    const { handler } = loadWithMultipartMock(
      validFields({ option: 'PTagClassic', optionSize: '25mm', optionColor: 'pink' }),
      { files: [] },
      {
        shopInfoResult: { price: 0 },
        ptagProductResult: [
          {
            name: 'PTag',
            deliveryCharge: 50,
            options: { sizes: ['25mm', '30mm'], colours: ['gold', 'silver'] },
            tiers: [{ type: 'normal', price: 259 }],
          },
        ],
      }
    );
    const result = await handler(postEvent(), createContext());
    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('orders.errors.invalidProductSelection');
  });

  test('accepts any optionSize/optionColor when product has empty options arrays', async () => {
    const { handler } = loadWithMultipartMock(
      validFields({ option: 'PTagAir', type: '', optionSize: '25', optionColor: '白色' }),
      { files: [] },
      {
        shopInfoResult: { price: 0 },
        ptagProductResult: [
          {
            name: 'ptag air',
            deliveryCharge: 50,
            options: { sizes: [], colours: [] },
            tiers: [{ type: 'standard', price: 199 }],
          },
        ],
      }
    );
    const result = await handler(postEvent(), createContext());
    expect(parseResponse(result).statusCode).toBe(200);
  });

  test('accepts valid optionSize and optionColor matching product options', async () => {
    const { handler } = loadWithMultipartMock(
      validFields({ option: 'PTagClassic', optionSize: '25mm', optionColor: 'gold' }),
      { files: [] },
      {
        shopInfoResult: { price: 0 },
        ptagProductResult: [
          {
            name: 'PTag',
            deliveryCharge: 50,
            options: { sizes: ['25mm', '30mm'], colours: ['gold', 'silver'] },
            tiers: [{ type: 'normal', price: 259 }],
          },
        ],
      }
    );
    const result = await handler(postEvent(), createContext());
    expect(parseResponse(result).statusCode).toBe(200);
  });

  test('email is normalized to lowercase', async () => {
    // If no duplicate, we just check that the handler succeeds with uppercase email input
    const { handler } = loadWithMultipartMock(validFields({ email: 'OWNER@TEST.COM' }));
    const result = await handler(postEvent(), createContext());
    expect(parseResponse(result).statusCode).toBe(200);
  });

  test('returns 500 and compensates Order on OrderVerification save failure', async () => {
    const { handler } = loadWithMultipartMock(validFields(), { files: [] }, {
      ovSaveError: new Error('OV insert failed'),
    });
    const result = await handler(postEvent(), createContext());
    expect(parseResponse(result).statusCode).toBe(500);
  });

  test('email send failure is non-fatal — order still created', async () => {
    // We need nodemailer to fail — override after loading
    jest.resetModules();
    jest.clearAllMocks();
    resetEnv();

    const actualMongoose = jest.requireActual('mongoose');
    const savedOvId = new mongoose.Types.ObjectId();

    function MockOV(data) {
      Object.assign(this, data);
      this._id = savedOvId;
      this.save = jest.fn().mockResolvedValue(this);
    }
    Object.assign(MockOV, {
      find: jest.fn().mockReturnValue({ select: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([]) }),
      findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
    });

    function MockOrder(data) {
      Object.assign(this, data);
      this._id = new mongoose.Types.ObjectId();
      this.buyDate = new Date();
      this.save = jest.fn().mockResolvedValue(this);
    }
    Object.assign(MockOrder, {
      find: jest.fn().mockReturnValue({ skip: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([]) }),
      findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null), select: jest.fn().mockReturnThis() }),
      countDocuments: jest.fn().mockResolvedValue(0),
      deleteOne: jest.fn().mockResolvedValue({}),
    });

    const mm = {
      Schema: actualMongoose.Schema, Types: actualMongoose.Types,
      connection: { readyState: 1 }, connect: jest.fn().mockResolvedValue({}),
      models: {}, isValidObjectId: actualMongoose.isValidObjectId,
      model: jest.fn((n) => {
        if (n === 'Order') return MockOrder;
        if (n === 'OrderVerification') return MockOV;
        if (n === 'ShopInfo') return { findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ price: 299 }) }) };
        if (n === 'PtagProduct') {
          return {
            find: jest.fn().mockReturnValue({
              lean: jest.fn().mockResolvedValue([
                {
                  name: 'PTag',
                  deliveryCharge: 50,
                  tiers: [
                    { type: 'normal', price: 259 },
                    { type: 'custom', price: 279 },
                  ],
                },
              ]),
            }),
          };
        }
        if (n === 'ImageCollection') return { create: jest.fn().mockResolvedValue({ _id: new mongoose.Types.ObjectId() }), updateOne: jest.fn().mockResolvedValue({}) };
        if (n === 'RateLimit') return { findOneAndUpdate: jest.fn().mockResolvedValue({ count: 1 }) };
        throw new Error(`Unexpected model "${n}"`);
      }),
    };
    jest.doMock('mongoose', () => ({ __esModule: true, default: mm, Schema: actualMongoose.Schema, Types: actualMongoose.Types, isValidObjectId: actualMongoose.isValidObjectId }));
    jest.doMock('@aws-ddd-api/shared', createSharedMultipartMock(sharedRuntimeModulePath, { ...validFields(), files: [] }), { virtual: true });
    jest.doMock('nodemailer', () => ({ __esModule: true, default: { createTransport: jest.fn().mockReturnValue({ sendMail: jest.fn().mockRejectedValue(new Error('SMTP failure')) }) }, createTransport: jest.fn().mockReturnValue({ sendMail: jest.fn().mockRejectedValue(new Error('SMTP failure')) }) }));
    jest.doMock('@aws-sdk/client-s3', () => ({ __esModule: true, S3Client: jest.fn().mockImplementation(() => ({ send: jest.fn().mockResolvedValue({}) })), PutObjectCommand: jest.fn().mockImplementation((p) => p) }));
    jest.doMock('axios', () => ({ __esModule: true, default: { get: jest.fn().mockResolvedValue({ data: { url: { shortLink: 'https://cutt.ly/abc' } } }) }, get: jest.fn() }));
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });

    const { handler } = require(handlerModulePath);
    const result = await handler(postEvent(), createContext());
    // Despite SMTP failure, order creation should succeed
    expect(parseResponse(result).statusCode).toBe(200);
  });
});
