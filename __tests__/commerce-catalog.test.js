/**
 * commerce-catalog Lambda — handler-level integration tests (Tier 2).
 *
 * Exercises the real exported `handler` (createApiGatewayHandler -> createRouter)
 * against all three commerce-catalog routes. MongoDB is mocked; no real DB.
 *
 * Routes under test:
 *   GET  /commerce/catalog           — public, returns product list
 *   POST /commerce/catalog/events    — public, records product-view event
 *   GET  /commerce/storefront        — public, returns shop metadata
 *
 * Run:  npm test -- __tests__/commerce-catalog.test.js --runInBand
 * Pre-req: npm run build:ts  (builds dist/)
 */

'use strict';

const path = require('path');
const mongoose = require('mongoose');

const handlerModulePath = path.resolve(__dirname, '../dist/functions/commerce-catalog/index.js');
const sharedRuntimeModulePath = path.resolve(
  __dirname,
  '../dist/layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/index.js'
);

// ─── helpers ──────────────────────────────────────────────────────────────────

function createContext() {
  return {
    awsRequestId: 'req-commerce-catalog-test',
    callbackWaitsForEmptyEventLoop: true,
  };
}

function createEvent({
  method = 'GET',
  path: eventPath = '/commerce/catalog',
  resource = '/commerce/catalog',
  body = null,
  headers = {},
  pathParameters = null,
  queryStringParameters = null,
} = {}) {
  return {
    httpMethod: method,
    path: eventPath,
    resource,
    headers: { 'Content-Type': 'application/json', origin: 'http://localhost:3000', ...headers },
    body: body !== null ? JSON.stringify(body) : null,
    pathParameters,
    queryStringParameters,
    multiValueQueryStringParameters: null,
    multiValueHeaders: {},
    stageVariables: null,
    requestContext: {
      requestId: 'req-commerce-catalog-test',
      identity: { sourceIp: '203.0.113.5' },
    },
    isBase64Encoded: false,
  };
}

function parseResponse(result) {
  return {
    statusCode: result.statusCode,
    headers: result.headers,
    body: result.body ? JSON.parse(result.body) : null,
  };
}

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
  delete process.env.AWS_SAM_LOCAL;
  Object.assign(process.env, overrides);
}

/**
 * Loads the compiled handler with mocked mongoose.
 *
 * productListResult  — value returned by ProductList.find().lean()
 * productListError   — thrown by ProductList.find().lean()
 * productLogCreate   — value returned by ProductLog.create()
 * productLogError    — thrown by ProductLog.create()
 * shopInfoResult     — value returned by ShopInfo.find().lean()
 * shopInfoError      — thrown by ShopInfo.find().lean()
 * connectError       — thrown by mongoose.connect
 */
function loadHandlerWithMocks({
  productListResult = [],
  productListError = null,
  productLogCreate = { _id: new mongoose.Types.ObjectId() },
  productLogError = null,
  shopInfoResult = [],
  shopInfoError = null,
  connectError = null,
} = {}) {
  jest.resetModules();
  jest.clearAllMocks();
  resetEnv();

  const actualMongoose = jest.requireActual('mongoose');

  const productListFind = jest.fn().mockReturnValue({
    lean: productListError
      ? jest.fn().mockRejectedValue(productListError)
      : jest.fn().mockResolvedValue(productListResult),
  });

  const productLogModelCreate = productLogError
    ? jest.fn().mockRejectedValue(productLogError)
    : jest.fn().mockResolvedValue(productLogCreate);

  const shopInfoFind = jest.fn().mockReturnValue({
    lean: shopInfoError
      ? jest.fn().mockRejectedValue(shopInfoError)
      : jest.fn().mockResolvedValue(shopInfoResult),
  });

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
      if (name === 'ProductList') return { find: productListFind };
      if (name === 'ProductLog') return { create: productLogModelCreate };
      if (name === 'ShopInfo') return { find: shopInfoFind };
      throw new Error(`Unexpected model "${name}"`);
    }),
  };

  jest.doMock('mongoose', () => ({
    __esModule: true,
    default: mongooseMock,
    Schema: actualMongoose.Schema,
    Types: actualMongoose.Types,
  }));

  jest.doMock('@aws-ddd-api/shared', () => require(sharedRuntimeModulePath), { virtual: true });

  const { handler } = require(handlerModulePath);
  return { handler, productListFind, productLogModelCreate, shopInfoFind };
}

// ─── handler infrastructure ───────────────────────────────────────────────────

describe('commerce-catalog Lambda — handler infrastructure', () => {
  test('returns 404 for an unknown route', async () => {
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({ method: 'GET', path: '/commerce/catalog/unknown', resource: '/commerce/catalog/unknown' }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(404);
  });

  test('returns 405 for known path with wrong method', async () => {
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({ method: 'DELETE', path: '/commerce/catalog', resource: '/commerce/catalog' }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(405);
  });

  test('handles OPTIONS preflight with 204', async () => {
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'OPTIONS',
        path: '/commerce/catalog',
        resource: '/commerce/catalog',
        headers: { origin: 'http://localhost:3000' },
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
      createEvent({ method: 'GET', path: '/commerce/catalog', resource: '/commerce/catalog' }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(500);
    expect(parsed.body.errorKey).toBe('common.internalError');
  });

  test('response includes content-type header', async () => {
    const { handler } = loadHandlerWithMocks({ productListResult: [] });

    const result = await handler(
      createEvent({ method: 'GET', path: '/commerce/catalog', resource: '/commerce/catalog' }),
      createContext()
    );

    expect(result.headers['content-type']).toBe('application/json');
  });
});

// ─── GET /commerce/catalog ────────────────────────────────────────────────────

describe('GET /commerce/catalog', () => {
  test('happy path — returns product list', async () => {
    const items = [
      { product_name: 'PTag Air', product_name_eng: 'PTag Air', price: '299', brand: 'PPC' },
      { product_name: 'PTag Classic', product_name_eng: 'PTag Classic', price: '199', brand: 'PPC' },
    ];
    const { handler } = loadHandlerWithMocks({ productListResult: items });

    const result = await handler(
      createEvent({ method: 'GET', path: '/commerce/catalog', resource: '/commerce/catalog' }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(200);
    expect(Array.isArray(parsed.body.items)).toBe(true);
    expect(parsed.body.items).toHaveLength(2);
    expect(parsed.body.items[0].product_name_eng).toBe('PTag Air');
  });

  test('returns 200 with empty array when catalog is empty', async () => {
    const { handler } = loadHandlerWithMocks({ productListResult: [] });

    const result = await handler(
      createEvent({ method: 'GET', path: '/commerce/catalog', resource: '/commerce/catalog' }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(200);
    expect(parsed.body.items).toEqual([]);
  });

  test('does not require auth — succeeds without requestContext.authorizer', async () => {
    const { handler } = loadHandlerWithMocks({ productListResult: [] });

    const event = createEvent({ method: 'GET', path: '/commerce/catalog', resource: '/commerce/catalog' });
    delete event.requestContext.authorizer;

    const result = await handler(event, createContext());
    expect(parseResponse(result).statusCode).toBe(200);
  });

  test('returns 500 when ProductList.find throws', async () => {
    const { handler } = loadHandlerWithMocks({
      productListError: new Error('db read failure'),
    });

    const result = await handler(
      createEvent({ method: 'GET', path: '/commerce/catalog', resource: '/commerce/catalog' }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(500);
    expect(parsed.body.errorKey).toBe('common.internalError');
  });
});

// ─── POST /commerce/catalog/events ───────────────────────────────────────────

describe('POST /commerce/catalog/events', () => {
  const validBody = {
    petId: 'pet-123',
    userId: 'user-456',
    userEmail: 'user@example.com',
    productUrl: 'https://shop.example.com/ptag-air',
  };

  test('happy path — creates catalog event and returns id', async () => {
    const createdId = new mongoose.Types.ObjectId();
    const { handler } = loadHandlerWithMocks({
      productLogCreate: { _id: createdId },
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/commerce/catalog/events',
        resource: '/commerce/catalog/events',
        body: validBody,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(201);
    expect(parsed.body.id).toBeDefined();
  });

  test('happy path — accepts optional accessAt field', async () => {
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/commerce/catalog/events',
        resource: '/commerce/catalog/events',
        body: { ...validBody, accessAt: '2026-05-06T12:00:00.000Z' },
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(201);
  });

  test('does not require auth — succeeds without requestContext.authorizer', async () => {
    const { handler } = loadHandlerWithMocks();

    const event = createEvent({
      method: 'POST',
      path: '/commerce/catalog/events',
      resource: '/commerce/catalog/events',
      body: validBody,
    });
    delete event.requestContext.authorizer;

    const result = await handler(event, createContext());
    expect(parseResponse(result).statusCode).toBe(201);
  });

  test('returns 400 for empty body', async () => {
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/commerce/catalog/events',
        resource: '/commerce/catalog/events',
        body: null,
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(400);
  });

  test('returns 400 for missing required field petId', async () => {
    const { handler } = loadHandlerWithMocks();
    const { petId: _omit, ...bodyWithoutPetId } = validBody;

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/commerce/catalog/events',
        resource: '/commerce/catalog/events',
        body: bodyWithoutPetId,
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(400);
  });

  test('returns 400 for missing required field userId', async () => {
    const { handler } = loadHandlerWithMocks();
    const { userId: _omit, ...bodyWithoutUserId } = validBody;

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/commerce/catalog/events',
        resource: '/commerce/catalog/events',
        body: bodyWithoutUserId,
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(400);
  });

  test('returns 400 for missing required field userEmail', async () => {
    const { handler } = loadHandlerWithMocks();
    const { userEmail: _omit, ...bodyWithoutEmail } = validBody;

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/commerce/catalog/events',
        resource: '/commerce/catalog/events',
        body: bodyWithoutEmail,
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(400);
  });

  test('returns 400 for missing required field productUrl', async () => {
    const { handler } = loadHandlerWithMocks();
    const { productUrl: _omit, ...bodyWithoutUrl } = validBody;

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/commerce/catalog/events',
        resource: '/commerce/catalog/events',
        body: bodyWithoutUrl,
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(400);
  });

  test('returns 400 for malformed JSON body', async () => {
    const { handler } = loadHandlerWithMocks();

    const event = createEvent({
      method: 'POST',
      path: '/commerce/catalog/events',
      resource: '/commerce/catalog/events',
    });
    event.body = '{bad json';

    const result = await handler(event, createContext());
    expect(parseResponse(result).statusCode).toBe(400);
  });

  test('returns 400 for empty object body', async () => {
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/commerce/catalog/events',
        resource: '/commerce/catalog/events',
        body: {},
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(400);
  });

  test('returns 500 when ProductLog.create throws', async () => {
    const { handler } = loadHandlerWithMocks({
      productLogError: new Error('db write failure'),
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/commerce/catalog/events',
        resource: '/commerce/catalog/events',
        body: validBody,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(500);
    expect(parsed.body.errorKey).toBe('common.internalError');
  });

  // Cyberattack cases

  test('attack — extra/unexpected fields are not persisted (mass assignment)', async () => {
    const { handler, productLogModelCreate } = loadHandlerWithMocks();

    await handler(
      createEvent({
        method: 'POST',
        path: '/commerce/catalog/events',
        resource: '/commerce/catalog/events',
        body: { ...validBody, isAdmin: true, role: 'superuser', __proto__: { polluted: true } },
      }),
      createContext()
    );

    const callArg = productLogModelCreate.mock.calls[0]?.[0];
    expect(callArg).toBeDefined();
    expect(callArg.isAdmin).toBeUndefined();
    expect(callArg.role).toBeUndefined();
  });

  test('attack — NoSQL operator injection in string fields is rejected by schema', async () => {
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/commerce/catalog/events',
        resource: '/commerce/catalog/events',
        body: { ...validBody, petId: { $gt: '' } },
      }),
      createContext()
    );

    // petId must be a string — object input fails Zod validation
    expect(parseResponse(result).statusCode).toBe(400);
  });

  test('attack — empty string field values fail min-length validation', async () => {
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/commerce/catalog/events',
        resource: '/commerce/catalog/events',
        body: { ...validBody, petId: '' },
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(400);
  });

  test('attack — array body instead of object is rejected', async () => {
    const { handler } = loadHandlerWithMocks();

    const event = createEvent({
      method: 'POST',
      path: '/commerce/catalog/events',
      resource: '/commerce/catalog/events',
    });
    event.body = JSON.stringify([validBody]);

    const result = await handler(event, createContext());
    expect(parseResponse(result).statusCode).toBe(400);
  });
});

// ─── GET /commerce/storefront ─────────────────────────────────────────────────

describe('GET /commerce/storefront', () => {
  const sampleShops = [
    {
      shopCode: 'HK01',
      shopName: 'PPC HK Central',
      shopAddress: '1 Test St, Central',
      shopContact: '+85212345678',
      shopContactPerson: 'Alice',
      price: 299,
    },
  ];

  test('happy path — returns shop list', async () => {
    const { handler } = loadHandlerWithMocks({ shopInfoResult: sampleShops });

    const result = await handler(
      createEvent({ method: 'GET', path: '/commerce/storefront', resource: '/commerce/storefront' }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(200);
    expect(Array.isArray(parsed.body.shops)).toBe(true);
    expect(parsed.body.shops).toHaveLength(1);
    expect(parsed.body.shops[0].shopCode).toBe('HK01');
  });

  test('returns 200 with empty array when no shops configured', async () => {
    const { handler } = loadHandlerWithMocks({ shopInfoResult: [] });

    const result = await handler(
      createEvent({ method: 'GET', path: '/commerce/storefront', resource: '/commerce/storefront' }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(200);
    expect(parsed.body.shops).toEqual([]);
  });

  test('does not require auth — succeeds without requestContext.authorizer', async () => {
    const { handler } = loadHandlerWithMocks({ shopInfoResult: sampleShops });

    const event = createEvent({ method: 'GET', path: '/commerce/storefront', resource: '/commerce/storefront' });
    delete event.requestContext.authorizer;

    const result = await handler(event, createContext());
    expect(parseResponse(result).statusCode).toBe(200);
  });

  test('sensitive fields bankName and bankNumber are not returned', async () => {
    const shopWithBank = [
      {
        ...sampleShops[0],
        bankName: 'HSBC',
        bankNumber: '123-456789',
      },
    ];
    // The projection in the service excludes bankName/bankNumber at the DB level.
    // Verify the mock is called with an explicit projection.
    const { handler, shopInfoFind } = loadHandlerWithMocks({ shopInfoResult: sampleShops });

    await handler(
      createEvent({ method: 'GET', path: '/commerce/storefront', resource: '/commerce/storefront' }),
      createContext()
    );

    const findCall = shopInfoFind.mock.calls[0];
    const projection = findCall?.[1];
    expect(projection).toBeDefined();
    expect(projection.bankName).toBeUndefined();
    expect(projection.bankNumber).toBeUndefined();
    expect(projection.shopCode).toBe(1);
  });

  test('returns 500 when ShopInfo.find throws', async () => {
    const { handler } = loadHandlerWithMocks({
      shopInfoError: new Error('db read failure'),
    });

    const result = await handler(
      createEvent({ method: 'GET', path: '/commerce/storefront', resource: '/commerce/storefront' }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(500);
    expect(parsed.body.errorKey).toBe('common.internalError');
  });

  // Cyberattack cases

  test('attack — returns 405 for POST on storefront (write protection)', async () => {
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/commerce/storefront',
        resource: '/commerce/storefront',
        body: { shopCode: 'EVIL', bankNumber: 'steal' },
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(405);
  });

  test('attack — returns 405 for PATCH on storefront (write protection)', async () => {
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'PATCH',
        path: '/commerce/storefront',
        resource: '/commerce/storefront',
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(405);
  });
});
