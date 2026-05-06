/**
 * Logistics Lambda — handler-level integration tests (Tier 2).
 *
 * Exercises the real exported `handler` (createApiGatewayHandler -> createRouter)
 * against all six logistics routes. External SF API calls and email are mocked.
 * Mongoose is mocked so DB-state assertions are deterministic.
 *
 * Run:  npm test -- __tests__/logistics.test.js --runInBand
 * Pre-req: npm run build:ts  (builds dist/)
 */

'use strict';

const path = require('path');
const mongoose = require('mongoose');

const handlerModulePath = path.resolve(__dirname, '../dist/functions/logistics/index.js');
const sharedRuntimeModulePath = path.resolve(
  __dirname,
  '../dist/layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/index.js'
);

const TEST_USER_ID = new mongoose.Types.ObjectId().toString();
const TEST_USER_EMAIL = 'logistics-test@example.com';

// ─── helpers ────────────────────────────────────────────────────────────────

function createContext() {
  return {
    awsRequestId: 'req-logistics-test',
    callbackWaitsForEmptyEventLoop: true,
  };
}

function createAuthorizer({ userId = TEST_USER_ID, role = 'user', email = TEST_USER_EMAIL } = {}) {
  return { userId, principalId: userId, userRole: role, userEmail: email };
}

function createEvent({
  method = 'POST',
  path: eventPath = '/logistics/token',
  resource = '/logistics/{proxy+}',
  body = null,
  authorizer,
  headers = {},
  pathParameters = null,
} = {}) {
  return {
    httpMethod: method,
    path: eventPath,
    resource,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body !== null ? JSON.stringify(body) : null,
    pathParameters,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    multiValueHeaders: {},
    stageVariables: null,
    requestContext: {
      requestId: 'req-logistics-test',
      authorizer: authorizer !== undefined ? authorizer : createAuthorizer(),
      identity: { sourceIp: '198.51.100.1' },
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
  process.env.SF_CUSTOMER_CODE = 'SF_TEST_CUSTOMER';
  process.env.SF_PRODUCTION_CHECK_CODE = 'SF_TEST_PROD_CODE';
  process.env.SF_SANDBOX_CHECK_CODE = 'SF_TEST_SANDBOX_CODE';
  process.env.SF_ADDRESS_API_KEY = 'SF_TEST_ADDRESS_KEY';
  process.env.SMTP_HOST = 'smtp.test.example';
  process.env.SMTP_PORT = '465';
  process.env.SMTP_USER = 'smtp-user@test.example';
  process.env.SMTP_PASS = 'smtp-pass';
  process.env.SMTP_FROM = 'noreply@test.example';
  delete process.env.AWS_SAM_LOCAL;

  Object.assign(process.env, overrides);
}

/**
 * Loads the compiled handler with mocked dependencies.
 *
 * sfExpressClientMocks: { getAccessToken, callSfService, downloadPdf }
 * sfAddressClientMocks: { fetchAddressToken, fetchAreaList, fetchNetCodeList, fetchPickupAddresses }
 * mailMocks:            { sendWaybillEmail }
 */
function loadHandlerWithMocks({
  authUserId = TEST_USER_ID,
  authRole = 'user',
  authEmail = TEST_USER_EMAIL,
  envOverrides = {},
  connectError = null,
  rateLimitEntry = {
    count: 1,
    expireAt: new Date(Date.now() + 60_000),
    windowStart: new Date(),
  },
  orderFindResult = [],
  orderUpdateManyResult = { modifiedCount: 0 },
  // SF address API mocks
  fetchAddressTokenResult = 'sf-address-bearer-token',
  fetchAddressTokenError = null,
  fetchAreaListResult = [{ id: 1, name: 'HK Island' }],
  fetchAreaListError = null,
  fetchNetCodeListResult = [{ netCode: 'HKG01' }],
  fetchNetCodeListError = null,
  fetchPickupAddressesResult = [[{ address: '123 Test St' }]],
  fetchPickupAddressesError = null,
  // SF express API mocks
  getAccessTokenResult = 'sf-access-token',
  getAccessTokenError = null,
  callSfServiceResult = {
    msgData: { waybillNoInfoList: [{ waybillNo: 'SF1234567890' }] },
  },
  callSfServiceError = null,
  downloadPdfResult = Buffer.from('fake-pdf'),
  downloadPdfError = null,
  sendWaybillEmailError = null,
} = {}) {
  jest.resetModules();
  jest.clearAllMocks();
  resetEnv(envOverrides);

  const actualMongoose = jest.requireActual('mongoose');

  const rateLimitModel = {
    findOneAndUpdate: jest.fn().mockResolvedValue(rateLimitEntry),
  };

  const orderFindChain = {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(orderFindResult),
  };

  const orderModel = {
    find: jest.fn().mockReturnValue(orderFindChain),
    updateMany: jest.fn().mockResolvedValue(orderUpdateManyResult),
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
      if (name === 'Order') return orderModel;
      if (name === 'RateLimit' || name === 'MongoRateLimit') return rateLimitModel;
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

  // SF address client
  jest.doMock(
    path.resolve(__dirname, '../dist/functions/logistics/src/config/sfAddressClient.js'),
    () => ({
      fetchAddressToken: fetchAddressTokenError
        ? jest.fn().mockRejectedValue(fetchAddressTokenError)
        : jest.fn().mockResolvedValue(fetchAddressTokenResult),
      fetchAreaList: fetchAreaListError
        ? jest.fn().mockRejectedValue(fetchAreaListError)
        : jest.fn().mockResolvedValue(fetchAreaListResult),
      fetchNetCodeList: fetchNetCodeListError
        ? jest.fn().mockRejectedValue(fetchNetCodeListError)
        : jest.fn().mockResolvedValue(fetchNetCodeListResult),
      fetchPickupAddresses: fetchPickupAddressesError
        ? jest.fn().mockRejectedValue(fetchPickupAddressesError)
        : jest.fn().mockResolvedValue(fetchPickupAddressesResult),
    })
  );

  // SF express client
  jest.doMock(
    path.resolve(__dirname, '../dist/functions/logistics/src/config/sfExpressClient.js'),
    () => ({
      SF_CLOUD_PRINT_URL: 'https://bspgw.sf-express.com/std/service',
      getAccessToken: getAccessTokenError
        ? jest.fn().mockRejectedValue(getAccessTokenError)
        : jest.fn().mockResolvedValue(getAccessTokenResult),
      callSfService: callSfServiceError
        ? jest.fn().mockRejectedValue(callSfServiceError)
        : jest.fn().mockResolvedValue(callSfServiceResult),
      downloadPdf: downloadPdfError
        ? jest.fn().mockRejectedValue(downloadPdfError)
        : jest.fn().mockResolvedValue(downloadPdfResult),
    })
  );

  // Mail
  jest.doMock(
    path.resolve(__dirname, '../dist/functions/logistics/src/config/mail.js'),
    () => ({
      sendWaybillEmail: sendWaybillEmailError
        ? jest.fn().mockRejectedValue(sendWaybillEmailError)
        : jest.fn().mockResolvedValue(undefined),
    })
  );

  const { handler } = require(handlerModulePath);
  return { handler, orderModel, rateLimitModel };
}

// ─── test suites ─────────────────────────────────────────────────────────────

describe('Logistics Lambda — handler infrastructure', () => {
  test('returns 405 for unknown route / method', async () => {
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({ method: 'DELETE', path: '/logistics/token', resource: '/logistics/{proxy+}' }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(405);
  });

  test('returns 500 when DB connection fails', async () => {
    const { handler } = loadHandlerWithMocks({
      connectError: new Error('mongo down'),
    });

    const result = await handler(
      createEvent({ method: 'POST', path: '/logistics/token', resource: '/logistics/{proxy+}' }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(500);
    expect(parsed.body.errorKey).toBe('common.internalError');
  });

  test('handles OPTIONS preflight with 204', async () => {
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'OPTIONS',
        path: '/logistics/token',
        resource: '/logistics/{proxy+}',
        headers: { origin: 'https://app.example.test' },
        authorizer: undefined,
      }),
      createContext()
    );

    expect(result.statusCode).toBe(204);
  });
});

// ─── POST /logistics/token ───────────────────────────────────────────────────

describe('POST /logistics/token', () => {
  test('happy path — returns SF address bearer token', async () => {
    const { handler } = loadHandlerWithMocks({
      fetchAddressTokenResult: 'my-bearer-token',
    });

    const result = await handler(
      createEvent({ method: 'POST', path: '/logistics/token' }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(200);
    expect(parsed.body.bearer_token).toBe('my-bearer-token');
  });

  test('returns 401 when no auth context', async () => {
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/logistics/token',
        authorizer: null,
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(401);
  });

  test('returns 429 when rate limit is exceeded', async () => {
    // Simulate rate limit throw from requireMongoRateLimit by manually wiring mocks
    jest.resetModules();
    jest.clearAllMocks();
    resetEnv();
    const actualMongoose = jest.requireActual('mongoose');
    const rateLimitError = Object.assign(new Error('common.rateLimited'), {
      statusCode: 429,
      result: { retryAfterSeconds: 120 },
    });

    const rateLimitMongooseMock = {
      Schema: actualMongoose.Schema,
      Types: actualMongoose.Types,
      connection: { readyState: 1 },
      models: {},
      model: jest.fn(() => ({
        findOneAndUpdate: jest.fn().mockRejectedValue(rateLimitError),
      })),
    };

    jest.doMock('mongoose', () => ({
      __esModule: true,
      default: rateLimitMongooseMock,
      Schema: actualMongoose.Schema,
      Types: actualMongoose.Types,
    }));

    jest.doMock('@aws-ddd-api/shared', () => require(sharedRuntimeModulePath), { virtual: true });

    jest.doMock(
      path.resolve(__dirname, '../dist/functions/logistics/src/config/sfAddressClient.js'),
      () => ({ fetchAddressToken: jest.fn() })
    );
    jest.doMock(
      path.resolve(__dirname, '../dist/functions/logistics/src/config/sfExpressClient.js'),
      () => ({ getAccessToken: jest.fn(), callSfService: jest.fn(), downloadPdf: jest.fn(), SF_CLOUD_PRINT_URL: '' })
    );
    jest.doMock(
      path.resolve(__dirname, '../dist/functions/logistics/src/config/mail.js'),
      () => ({ sendWaybillEmail: jest.fn() })
    );

    const { handler: rateLimitedHandler } = require(handlerModulePath);

    const result = await rateLimitedHandler(
      createEvent({ method: 'POST', path: '/logistics/token' }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(429);
  });

  test('returns 500 when SF address service throws', async () => {
    const { handler } = loadHandlerWithMocks({
      fetchAddressTokenError: new Error('network error'),
    });

    const result = await handler(
      createEvent({ method: 'POST', path: '/logistics/token' }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(500);
    expect(parsed.body.errorKey).toBe('common.internalError');
  });
});

// ─── POST /logistics/lookups/areas ──────────────────────────────────────────

describe('POST /logistics/lookups/areas', () => {
  test('happy path — returns area list', async () => {
    const { handler } = loadHandlerWithMocks({
      fetchAreaListResult: [{ id: 1, name: 'HK Island' }],
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/logistics/lookups/areas',
        body: { token: 'valid-token' },
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(200);
    expect(Array.isArray(parsed.body.area_list)).toBe(true);
  });

  test('returns 400 when token is missing', async () => {
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/logistics/lookups/areas',
        body: { lang: 'en' },
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('logistics.validation.tokenRequired');
  });

  test('returns 400 when body is missing entirely', async () => {
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/logistics/lookups/areas',
        body: null,
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(400);
  });

  test('returns 400 when body is not valid JSON', async () => {
    const { handler } = loadHandlerWithMocks();

    const event = createEvent({ method: 'POST', path: '/logistics/lookups/areas' });
    event.body = 'not-json{{{';

    const result = await handler(event, createContext());
    expect(parseResponse(result).statusCode).toBe(400);
  });

  test('returns 500 when SF address API throws', async () => {
    const { handler } = loadHandlerWithMocks({
      fetchAreaListError: new Error('network error'),
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/logistics/lookups/areas',
        body: { token: 'valid-token' },
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(500);
  });
});

// ─── POST /logistics/lookups/net-codes ──────────────────────────────────────

describe('POST /logistics/lookups/net-codes', () => {
  test('happy path — returns net code list', async () => {
    const { handler } = loadHandlerWithMocks({
      fetchNetCodeListResult: [{ netCode: 'HKG01' }],
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/logistics/lookups/net-codes',
        body: { token: 'valid-token', typeId: '1', areaId: '2' },
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(200);
    expect(parsed.body.netCode).toBeDefined();
  });

  test('returns 400 when token is missing', async () => {
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/logistics/lookups/net-codes',
        body: { typeId: '1', areaId: '2' },
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('logistics.validation.tokenRequired');
  });

  test('returns 400 when typeId is missing', async () => {
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/logistics/lookups/net-codes',
        body: { token: 'valid-token', areaId: '2' },
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('logistics.validation.typeIdRequired');
  });
});

// ─── POST /logistics/lookups/pickup-locations ───────────────────────────────

describe('POST /logistics/lookups/pickup-locations', () => {
  test('happy path — returns pickup address list', async () => {
    const { handler } = loadHandlerWithMocks({
      fetchPickupAddressesResult: [[{ address: '123 Test St' }]],
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/logistics/lookups/pickup-locations',
        body: { token: 'valid-token', netCode: ['HKG01'], lang: 'en' },
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(200);
    expect(Array.isArray(parsed.body.addresses)).toBe(true);
  });

  test('returns 400 when netCode is empty array', async () => {
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/logistics/lookups/pickup-locations',
        body: { token: 'valid-token', netCode: [] },
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('logistics.validation.netCodeListRequired');
  });

  test('returns 400 when netCode is missing', async () => {
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/logistics/lookups/pickup-locations',
        body: { token: 'valid-token' },
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(400);
  });
});

// ─── POST /logistics/shipments ───────────────────────────────────────────────

describe('POST /logistics/shipments', () => {
  test('happy path — creates shipment and returns tracking number', async () => {
    const { handler, orderModel } = loadHandlerWithMocks({
      callSfServiceResult: {
        msgData: { waybillNoInfoList: [{ waybillNo: 'SF9999999999' }] },
      },
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/logistics/shipments',
        body: {
          lastName: 'Chan',
          phoneNumber: '+85291234567',
          address: '1 Test Road, HK',
          count: 1,
          tempIdList: [],
        },
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(200);
    expect(parsed.body.trackingNumber).toBe('SF9999999999');
    expect(orderModel.updateMany).not.toHaveBeenCalled(); // no tempIds matched
  });

  test('writes waybill number to matched orders', async () => {
    const tempId = 'temp-abc-123';
    const { handler, orderModel } = loadHandlerWithMocks({
      orderFindResult: [{ _id: 'order-1', tempId, email: TEST_USER_EMAIL }],
      callSfServiceResult: {
        msgData: { waybillNoInfoList: [{ waybillNo: 'SF8888888888' }] },
      },
    });

    await handler(
      createEvent({
        method: 'POST',
        path: '/logistics/shipments',
        body: {
          lastName: 'Chan',
          phoneNumber: '+85291234567',
          address: '1 Test Road, HK',
          tempId,
        },
      }),
      createContext()
    );

    expect(orderModel.updateMany).toHaveBeenCalledWith(
      { tempId: { $in: [tempId] } },
      { $set: { sfWayBillNumber: 'SF8888888888' } }
    );
  });

  test('privileged role (admin) bypasses ownership check', async () => {
    const adminId = new mongoose.Types.ObjectId().toString();
    const { handler, orderModel } = loadHandlerWithMocks({
      authRole: 'admin',
      authEmail: 'admin@example.com',
      orderFindResult: [{ _id: 'order-1', tempId: 'temp-xyz', email: 'other@example.com' }],
      callSfServiceResult: {
        msgData: { waybillNoInfoList: [{ waybillNo: 'SF7777777777' }] },
      },
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/logistics/shipments',
        authorizer: createAuthorizer({ userId: adminId, role: 'admin', email: 'admin@example.com' }),
        body: {
          lastName: 'Admin',
          phoneNumber: '+85291234567',
          address: '1 Test Road, HK',
          tempId: 'temp-xyz',
        },
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(200);
  });

  test('returns 403 when caller does not own the order', async () => {
    const { handler } = loadHandlerWithMocks({
      authEmail: TEST_USER_EMAIL,
      orderFindResult: [{ _id: 'order-1', tempId: 'temp-xyz', email: 'different@example.com' }],
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/logistics/shipments',
        authorizer: createAuthorizer({ role: 'user', email: TEST_USER_EMAIL }),
        body: {
          lastName: 'Chan',
          phoneNumber: '+85291234567',
          address: '1 Test Road, HK',
          tempId: 'temp-xyz',
        },
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(403);
    expect(parsed.body.errorKey).toBe('common.unauthorized');
  });

  test('returns 400 when lastName is missing', async () => {
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/logistics/shipments',
        body: { phoneNumber: '+85291234567', address: '1 Test Road' },
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('logistics.validation.lastNameRequired');
  });

  test('returns 400 when phoneNumber is missing', async () => {
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/logistics/shipments',
        body: { lastName: 'Chan', address: '1 Test Road' },
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('logistics.validation.phoneNumberRequired');
  });

  test('returns 400 when address is missing', async () => {
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/logistics/shipments',
        body: { lastName: 'Chan', phoneNumber: '+85291234567' },
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('logistics.validation.addressRequired');
  });

  test('returns 500 when SF API returns no waybill', async () => {
    const { handler } = loadHandlerWithMocks({
      callSfServiceResult: { msgData: { waybillNoInfoList: [] } },
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/logistics/shipments',
        body: { lastName: 'Chan', phoneNumber: '+85291234567', address: '1 Test Road' },
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(500);
    expect(parsed.body.errorKey).toBe('logistics.missingWaybill');
  });

  test('returns 500 when SF access token call fails', async () => {
    const { handler } = loadHandlerWithMocks({
      getAccessTokenError: new Error('SF auth failed'),
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/logistics/shipments',
        body: { lastName: 'Chan', phoneNumber: '+85291234567', address: '1 Test Road' },
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(500);
  });

  test('returns 401 when no auth context (unauthenticated request)', async () => {
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/logistics/shipments',
        authorizer: null,
        body: { lastName: 'Chan', phoneNumber: '+85291234567', address: '1 Test Road' },
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(401);
  });
});

// ─── POST /logistics/cloud-waybill ──────────────────────────────────────────

describe('POST /logistics/cloud-waybill', () => {
  test('happy path — prints cloud waybill and sends email', async () => {
    const { handler } = loadHandlerWithMocks({
      callSfServiceResult: {
        success: true,
        obj: { files: [{ url: 'https://sf.example.com/waybill.pdf', token: 'pdf-token' }] },
      },
      downloadPdfResult: Buffer.from('fake-pdf-content'),
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/logistics/cloud-waybill',
        body: { waybillNo: 'SF1234567890' },
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(200);
    expect(parsed.body.waybillNo).toBe('SF1234567890');
  });

  test('returns 400 when waybillNo is missing', async () => {
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/logistics/cloud-waybill',
        body: { carrier: 'sf' },
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('logistics.validation.waybillNoRequired');
  });

  test('returns 400 when body is null', async () => {
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/logistics/cloud-waybill',
        body: null,
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(400);
  });

  test('returns 500 when SF API returns success=false', async () => {
    const { handler } = loadHandlerWithMocks({
      callSfServiceResult: { success: false },
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/logistics/cloud-waybill',
        body: { waybillNo: 'SF1234567890' },
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(500);
    expect(parsed.body.errorKey).toBe('logistics.sfApiError');
  });

  test('returns 500 when SF API returns empty files array', async () => {
    const { handler } = loadHandlerWithMocks({
      callSfServiceResult: { success: true, obj: { files: [] } },
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/logistics/cloud-waybill',
        body: { waybillNo: 'SF1234567890' },
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(500);
    expect(parsed.body.errorKey).toBe('logistics.missingPrintFile');
  });

  test('returns 500 when PDF download fails', async () => {
    const { handler } = loadHandlerWithMocks({
      callSfServiceResult: {
        success: true,
        obj: { files: [{ url: 'https://sf.example.com/waybill.pdf', token: 'pdf-token' }] },
      },
      downloadPdfError: new Error('logistics.sfApiError'),
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/logistics/cloud-waybill',
        body: { waybillNo: 'SF1234567890' },
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(500);
    expect(parsed.body.errorKey).toBe('logistics.sfApiError');
  });

  test('returns 500 when email send fails without leaking details', async () => {
    const { handler } = loadHandlerWithMocks({
      callSfServiceResult: {
        success: true,
        obj: { files: [{ url: 'https://sf.example.com/waybill.pdf', token: 'pdf-token' }] },
      },
      downloadPdfResult: Buffer.from('pdf'),
      sendWaybillEmailError: new Error('SMTP connection refused'),
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/logistics/cloud-waybill',
        body: { waybillNo: 'SF1234567890' },
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(500);
    expect(parsed.body.errorKey).toBe('common.internalError');
    // Must not leak SMTP error message to client
    expect(JSON.stringify(parsed.body)).not.toContain('SMTP');
    expect(JSON.stringify(parsed.body)).not.toContain('connection refused');
  });

  test('returns 401 when no auth context', async () => {
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/logistics/cloud-waybill',
        authorizer: null,
        body: { waybillNo: 'SF1234567890' },
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(401);
  });
});
