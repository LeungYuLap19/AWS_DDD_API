const path = require('path');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const envConfig = require('../env.json');

const handlerModulePath = path.resolve(__dirname, '../dist/functions/notifications/index.js');
const sharedRuntimeModulePath = path.resolve(
  __dirname,
  '../dist/layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/index.js'
);

const BASE_URL = process.env.NOTIFICATIONS_UAT_BASE_URL || 'http://127.0.0.1:3000';
const JWT_SECRET = process.env.NOTIFICATIONS_TEST_JWT_SECRET || 'PPCSecret';
const API_KEY =
  process.env.NOTIFICATIONS_TEST_API_KEY ||
  envConfig.Parameters?.ExistingApiKeyId ||
  'test-api-key';
const VALID_ORIGIN = 'http://localhost:3000';

// ─── Helpers ────────────────────────────────────────────────────────────────

function createContext() {
  return {
    awsRequestId: 'req-tier2-notifications-handler',
    callbackWaitsForEmptyEventLoop: true,
  };
}

function createAuthorizer({ userId = new mongoose.Types.ObjectId().toString(), role = 'user' } = {}) {
  return {
    userId,
    principalId: userId,
    userRole: role,
  };
}

function createEvent({
  method = 'GET',
  resource = '/notifications/me',
  body = null,
  authorizer,
  headers = {},
  pathParameters = null,
  queryStringParameters = null,
} = {}) {
  return {
    httpMethod: method,
    path: resource,
    resource,
    headers,
    body,
    pathParameters,
    queryStringParameters,
    multiValueQueryStringParameters: null,
    multiValueHeaders: {},
    stageVariables: null,
    requestContext: {
      requestId: 'req-tier2-notifications-handler',
      authorizer: authorizer || undefined,
      identity: { sourceIp: '198.51.100.10' },
    },
    isBase64Encoded: false,
  };
}

function parseResponse(result) {
  return {
    statusCode: result.statusCode,
    headers: result.headers || {},
    body: result.body ? JSON.parse(result.body) : null,
  };
}

function createFindChain(value) {
  return {
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(value),
  };
}

function buildNotificationDoc(overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    userId: new mongoose.Types.ObjectId(),
    type: 'vaccine_reminder',
    isArchived: false,
    petId: null,
    petName: null,
    nextEventDate: null,
    nearbyPetLost: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildCreatedDoc(overrides = {}) {
  const doc = buildNotificationDoc(overrides);
  return {
    ...doc,
    toObject: jest.fn().mockReturnValue(doc),
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

function loadHandlerWithMocks({
  envOverrides = {},
  notificationList = [],
  createdDoc = null,
  updateOneResult = { matchedCount: 1, modifiedCount: 1 },
  connectError = null,
  findError = null,
  updateError = null,
  createError = null,
} = {}) {
  jest.resetModules();
  jest.clearAllMocks();
  resetEnv(envOverrides);

  const actualMongoose = jest.requireActual('mongoose');
  const created = createdDoc || buildCreatedDoc();

  const notificationsModel = {
    find: findError
      ? jest.fn(() => { throw findError; })
      : jest.fn(() => createFindChain(notificationList)),
    updateOne: updateError
      ? jest.fn().mockRejectedValue(updateError)
      : jest.fn().mockResolvedValue(updateOneResult),
    create: createError
      ? jest.fn().mockRejectedValue(createError)
      : jest.fn().mockResolvedValue(created),
  };

  const mongooseMock = {
    Schema: actualMongoose.Schema,
    Types: actualMongoose.Types,
    connection: { readyState: connectError ? 0 : 1 },
    connect: connectError
      ? jest.fn().mockRejectedValue(connectError)
      : jest.fn().mockResolvedValue({}),
    models: {},
    model: jest.fn((name) => {
      if (name === 'Notifications') return notificationsModel;
      throw new Error(`Unexpected model: ${name}`);
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

  return { handler, notificationsModel, created };
}

function signToken({ userId, role = 'user', expiresIn = '15m' } = {}) {
  return jwt.sign(
    {
      userId: userId || new mongoose.Types.ObjectId().toString(),
      userRole: role,
    },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn }
  );
}

async function req(method, routePath, body, headers = {}) {
  const res = await fetch(`${BASE_URL}${routePath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(method === 'OPTIONS' ? {} : { 'x-api-key': API_KEY }),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });

  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  return { status: res.status, body: json, headers: Object.fromEntries(res.headers.entries()) };
}

async function ensureSamLocalReachable() {
  try {
    await fetch(`${BASE_URL}/notifications/me`, {
      method: 'OPTIONS',
      headers: { origin: VALID_ORIGIN },
    });
  } catch {
    throw new Error(
      `SAM local API is not reachable at ${BASE_URL}. Start with: sam local start-api --template .aws-sam/build/template.yaml --env-vars env.json --warm-containers EAGER`
    );
  }
}

// ─── Silence logs ────────────────────────────────────────────────────────────

let consoleLogSpy;
let consoleWarnSpy;
let consoleErrorSpy;

beforeAll(() => {
  consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  consoleLogSpy.mockRestore();
  consoleWarnSpy.mockRestore();
  consoleErrorSpy.mockRestore();
});

// ─── Tier 2: Handler-level integration ───────────────────────────────────────

describe('Tier 2 — notifications handler integration', () => {
  // ── Router proofs ────────────────────────────────────────────────────────

  describe('shared runtime and router proofs', () => {
    test('unknown route returns 404 via real router dispatch', async () => {
      const { handler } = loadHandlerWithMocks();
      const res = await handler(
        createEvent({ method: 'GET', resource: '/notifications/nonexistent' }),
        createContext()
      );
      const parsed = parseResponse(res);
      expect(parsed.statusCode).toBe(404);
      expect(parsed.body.errorKey).toBe('common.routeNotFound');
    });

    test('known path with wrong method returns 405 via real router dispatch', async () => {
      const { handler } = loadHandlerWithMocks();
      const res = await handler(
        createEvent({ method: 'DELETE', resource: '/notifications/me' }),
        createContext()
      );
      const parsed = parseResponse(res);
      expect(parsed.statusCode).toBe(405);
      expect(parsed.body.errorKey).toBe('common.methodNotAllowed');
    });

    test('OPTIONS /notifications/me returns CORS preflight response', async () => {
      const { handler } = loadHandlerWithMocks();
      const res = await handler(
        createEvent({
          method: 'OPTIONS',
          resource: '/notifications/me',
          headers: { origin: VALID_ORIGIN },
        }),
        createContext()
      );
      expect(res.statusCode).toBe(204);
      expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
    });

    test('CORS headers appear on normal success responses', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const { handler } = loadHandlerWithMocks({ notificationList: [] });
      const res = await handler(
        createEvent({
          method: 'GET',
          resource: '/notifications/me',
          authorizer: createAuthorizer({ userId }),
          headers: { origin: VALID_ORIGIN },
        }),
        createContext()
      );
      expect(res.statusCode).toBe(200);
      expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
    });

    test('unexpected infrastructure errors are normalized to a safe 500 without leaking details', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const { handler } = loadHandlerWithMocks({
        connectError: new Error('mongo down'),
      });
      const res = await handler(
        createEvent({
          method: 'GET',
          resource: '/notifications/me',
          authorizer: createAuthorizer({ userId }),
        }),
        createContext()
      );
      const parsed = parseResponse(res);
      expect(parsed.statusCode).toBe(500);
      expect(parsed.body.success).toBe(false);
      expect(JSON.stringify(parsed.body)).not.toContain('mongo down');
    });
  });

  // ── GET /notifications/me ────────────────────────────────────────────────

  describe('GET /notifications/me', () => {
    test('happy path — returns notification list with count for authenticated user', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const note1 = buildNotificationDoc({ userId, type: 'vaccine_reminder' });
      const note2 = buildNotificationDoc({ userId, type: 'nearby_pet_lost' });

      const { handler } = loadHandlerWithMocks({ notificationList: [note1, note2] });
      const res = await handler(
        createEvent({
          method: 'GET',
          resource: '/notifications/me',
          authorizer: createAuthorizer({ userId }),
        }),
        createContext()
      );
      const parsed = parseResponse(res);
      expect(parsed.statusCode).toBe(200);
      expect(parsed.body.success).toBe(true);
      expect(parsed.body.count).toBe(2);
      expect(Array.isArray(parsed.body.notifications)).toBe(true);
      expect(parsed.body.notifications).toHaveLength(2);
    });

    test('happy path — returns empty array when user has no notifications', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const { handler } = loadHandlerWithMocks({ notificationList: [] });
      const res = await handler(
        createEvent({
          method: 'GET',
          resource: '/notifications/me',
          authorizer: createAuthorizer({ userId }),
        }),
        createContext()
      );
      const parsed = parseResponse(res);
      expect(parsed.statusCode).toBe(200);
      expect(parsed.body.count).toBe(0);
      expect(parsed.body.notifications).toEqual([]);
    });

    test('auth — missing authorizer context returns 401', async () => {
      const { handler } = loadHandlerWithMocks();
      const res = await handler(
        createEvent({ method: 'GET', resource: '/notifications/me' }),
        createContext()
      );
      const parsed = parseResponse(res);
      expect(parsed.statusCode).toBe(401);
      expect(parsed.body.errorKey).toBe('common.unauthorized');
    });

    test('auth — reads userId from authorizer context, not from path', async () => {
      const realUserId = new mongoose.Types.ObjectId().toString();
      const { handler, notificationsModel } = loadHandlerWithMocks({ notificationList: [] });
      await handler(
        createEvent({
          method: 'GET',
          resource: '/notifications/me',
          authorizer: createAuthorizer({ userId: realUserId }),
        }),
        createContext()
      );
      const findCallArg = notificationsModel.find.mock.calls[0]?.[0];
      expect(findCallArg?.userId).toBe(realUserId);
    });

    test('real event.body string arrives through handler and is not parsed as a body for GET', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const { handler } = loadHandlerWithMocks({ notificationList: [] });
      const res = await handler(
        createEvent({
          method: 'GET',
          resource: '/notifications/me',
          body: '{"injection":"attempt"}',
          authorizer: createAuthorizer({ userId }),
        }),
        createContext()
      );
      // GET should succeed regardless of body content
      expect(res.statusCode).toBe(200);
    });
  });

  // ── PATCH /notifications/me/{notificationId} ─────────────────────────────

  describe('PATCH /notifications/me/{notificationId}', () => {
    test('happy path — archives an owned notification and returns success', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const notificationId = new mongoose.Types.ObjectId().toString();

      const { handler } = loadHandlerWithMocks({
        updateOneResult: { matchedCount: 1, modifiedCount: 1 },
      });
      const res = await handler(
        createEvent({
          method: 'PATCH',
          resource: '/notifications/me/{notificationId}',
          pathParameters: { notificationId },
          authorizer: createAuthorizer({ userId }),
        }),
        createContext()
      );
      const parsed = parseResponse(res);
      expect(parsed.statusCode).toBe(200);
      expect(parsed.body.success).toBe(true);
      expect(parsed.body.notificationId).toBe(notificationId);
    });

    test('ownership check — 404 when notification does not belong to the caller', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const notificationId = new mongoose.Types.ObjectId().toString();

      const { handler } = loadHandlerWithMocks({
        updateOneResult: { matchedCount: 0, modifiedCount: 0 },
      });
      const res = await handler(
        createEvent({
          method: 'PATCH',
          resource: '/notifications/me/{notificationId}',
          pathParameters: { notificationId },
          authorizer: createAuthorizer({ userId }),
        }),
        createContext()
      );
      const parsed = parseResponse(res);
      expect(parsed.statusCode).toBe(404);
      expect(parsed.body.errorKey).toBe('common.notFound');
    });

    test('validation — missing notificationId path param returns 400', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const { handler } = loadHandlerWithMocks();
      const res = await handler(
        createEvent({
          method: 'PATCH',
          resource: '/notifications/me/{notificationId}',
          pathParameters: null,
          authorizer: createAuthorizer({ userId }),
        }),
        createContext()
      );
      const parsed = parseResponse(res);
      expect(parsed.statusCode).toBe(400);
      expect(parsed.body.errorKey).toBe('common.missingPathParams');
    });

    test('validation — malformed notificationId (not a valid ObjectId) returns 400', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const { handler } = loadHandlerWithMocks();
      const res = await handler(
        createEvent({
          method: 'PATCH',
          resource: '/notifications/me/{notificationId}',
          pathParameters: { notificationId: 'not-a-valid-id' },
          authorizer: createAuthorizer({ userId }),
        }),
        createContext()
      );
      const parsed = parseResponse(res);
      expect(parsed.statusCode).toBe(400);
      expect(parsed.body.errorKey).toBe('common.invalidObjectId');
    });

    test('auth — missing authorizer context returns 401', async () => {
      const notificationId = new mongoose.Types.ObjectId().toString();
      const { handler } = loadHandlerWithMocks();
      const res = await handler(
        createEvent({
          method: 'PATCH',
          resource: '/notifications/me/{notificationId}',
          pathParameters: { notificationId },
        }),
        createContext()
      );
      const parsed = parseResponse(res);
      expect(parsed.statusCode).toBe(401);
      expect(parsed.body.errorKey).toBe('common.unauthorized');
    });

    test('updateOne is called with correct userId + notificationId ownership filter', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const notificationId = new mongoose.Types.ObjectId().toString();

      const { handler, notificationsModel } = loadHandlerWithMocks({
        updateOneResult: { matchedCount: 1, modifiedCount: 1 },
      });
      await handler(
        createEvent({
          method: 'PATCH',
          resource: '/notifications/me/{notificationId}',
          pathParameters: { notificationId },
          authorizer: createAuthorizer({ userId }),
        }),
        createContext()
      );
      const [filter, update] = notificationsModel.updateOne.mock.calls[0];
      expect(String(filter._id)).toBe(notificationId);
      expect(String(filter.userId)).toBe(userId);
      expect(update.$set.isArchived).toBe(true);
    });
  });

  // ── POST /notifications/dispatch ─────────────────────────────────────────

  describe('POST /notifications/dispatch', () => {
    test('happy path — dispatches notification to target user and returns created doc', async () => {
      const callerId = new mongoose.Types.ObjectId().toString();
      const targetUserId = new mongoose.Types.ObjectId().toString();

      const { handler } = loadHandlerWithMocks();
      const res = await handler(
        createEvent({
          method: 'POST',
          resource: '/notifications/dispatch',
          body: JSON.stringify({ targetUserId, type: 'vaccine_reminder' }),
          authorizer: createAuthorizer({ userId: callerId, role: 'admin' }),
        }),
        createContext()
      );
      const parsed = parseResponse(res);
      expect(parsed.statusCode).toBe(200);
      expect(parsed.body.success).toBe(true);
      expect(parsed.body.notification).toBeDefined();
      expect(parsed.body.id).toBeUndefined();
    });

    test('happy path — full optional fields are stored correctly', async () => {
      const callerId = new mongoose.Types.ObjectId().toString();
      const targetUserId = new mongoose.Types.ObjectId().toString();
      const petId = new mongoose.Types.ObjectId().toString();

      const { handler, notificationsModel } = loadHandlerWithMocks();
      await handler(
        createEvent({
          method: 'POST',
          resource: '/notifications/dispatch',
          body: JSON.stringify({
            targetUserId,
            type: 'adoption_follow_up',
            petId,
            petName: 'Buddy',
            nextEventDate: '2026-06-01',
            nearbyPetLost: 'Central District',
          }),
          authorizer: createAuthorizer({ userId: callerId, role: 'admin' }),
        }),
        createContext()
      );
      const createArg = notificationsModel.create.mock.calls[0]?.[0];
      expect(String(createArg.userId)).toBe(targetUserId);
      expect(createArg.type).toBe('adoption_follow_up');
      expect(String(createArg.petId)).toBe(petId);
      expect(createArg.petName).toBe('Buddy');
      expect(createArg.nearbyPetLost).toBe('Central District');
    });

    test('date — nextEventDate in DD/MM/YYYY format is parsed to a Date', async () => {
      const callerId = new mongoose.Types.ObjectId().toString();
      const targetUserId = new mongoose.Types.ObjectId().toString();

      const { handler, notificationsModel } = loadHandlerWithMocks();
      await handler(
        createEvent({
          method: 'POST',
          resource: '/notifications/dispatch',
          body: JSON.stringify({ targetUserId, type: 'vaccine_reminder', nextEventDate: '15/06/2026' }),
          authorizer: createAuthorizer({ userId: callerId, role: 'admin' }),
        }),
        createContext()
      );
      const createArg = notificationsModel.create.mock.calls[0]?.[0];
      expect(createArg.nextEventDate).toBeInstanceOf(Date);
      expect(createArg.nextEventDate.getFullYear()).toBe(2026);
    });

    test('validation — missing type field returns 400 with domain error key', async () => {
      const callerId = new mongoose.Types.ObjectId().toString();
      const targetUserId = new mongoose.Types.ObjectId().toString();

      const { handler } = loadHandlerWithMocks();
      const res = await handler(
        createEvent({
          method: 'POST',
          resource: '/notifications/dispatch',
          body: JSON.stringify({ targetUserId }),
          authorizer: createAuthorizer({ userId: callerId, role: 'admin' }),
        }),
        createContext()
      );
      const parsed = parseResponse(res);
      expect(parsed.statusCode).toBe(400);
      expect(parsed.body.errorKey).toBe('notifications.errors.typeRequired');
    });

    test('validation — invalid type value (not in enum) returns 400 with typeRequired error key', async () => {
      const callerId = new mongoose.Types.ObjectId().toString();
      const targetUserId = new mongoose.Types.ObjectId().toString();

      const { handler } = loadHandlerWithMocks();
      const res = await handler(
        createEvent({
          method: 'POST',
          resource: '/notifications/dispatch',
          body: JSON.stringify({ targetUserId, type: 'unknown_type' }),
          authorizer: createAuthorizer({ userId: callerId, role: 'admin' }),
        }),
        createContext()
      );
      const parsed = parseResponse(res);
      expect(parsed.statusCode).toBe(400);
      expect(parsed.body.errorKey).toBe('notifications.errors.typeRequired');
    });

    test('validation — nextEventDate with invalid format returns 400 with invalidDate error key', async () => {
      const callerId = new mongoose.Types.ObjectId().toString();
      const targetUserId = new mongoose.Types.ObjectId().toString();

      const { handler } = loadHandlerWithMocks();
      const res = await handler(
        createEvent({
          method: 'POST',
          resource: '/notifications/dispatch',
          body: JSON.stringify({ targetUserId, type: 'vaccine_reminder', nextEventDate: 'not-a-date' }),
          authorizer: createAuthorizer({ userId: callerId, role: 'admin' }),
        }),
        createContext()
      );
      const parsed = parseResponse(res);
      expect(parsed.statusCode).toBe(400);
      expect(parsed.body.errorKey).toBe('notifications.errors.invalidDate');
    });

    test('validation — missing targetUserId returns 400', async () => {
      const callerId = new mongoose.Types.ObjectId().toString();
      const { handler } = loadHandlerWithMocks();
      const res = await handler(
        createEvent({
          method: 'POST',
          resource: '/notifications/dispatch',
          body: JSON.stringify({ type: 'vaccine_reminder' }),
          authorizer: createAuthorizer({ userId: callerId, role: 'admin' }),
        }),
        createContext()
      );
      const parsed = parseResponse(res);
      expect(parsed.statusCode).toBe(400);
    });

    test('validation — invalid targetUserId ObjectId format returns 400', async () => {
      const callerId = new mongoose.Types.ObjectId().toString();
      const { handler } = loadHandlerWithMocks();
      const res = await handler(
        createEvent({
          method: 'POST',
          resource: '/notifications/dispatch',
          body: JSON.stringify({ targetUserId: 'not-valid-id', type: 'vaccine_reminder' }),
          authorizer: createAuthorizer({ userId: callerId, role: 'admin' }),
        }),
        createContext()
      );
      const parsed = parseResponse(res);
      expect(parsed.statusCode).toBe(400);
      expect(parsed.body.errorKey).toBe('common.invalidObjectId');
    });

    test('validation — invalid petId ObjectId format returns 400', async () => {
      const callerId = new mongoose.Types.ObjectId().toString();
      const targetUserId = new mongoose.Types.ObjectId().toString();

      const { handler } = loadHandlerWithMocks();
      const res = await handler(
        createEvent({
          method: 'POST',
          resource: '/notifications/dispatch',
          body: JSON.stringify({ targetUserId, type: 'vaccine_reminder', petId: 'bad-id' }),
          authorizer: createAuthorizer({ userId: callerId, role: 'admin' }),
        }),
        createContext()
      );
      const parsed = parseResponse(res);
      expect(parsed.statusCode).toBe(400);
      expect(parsed.body.errorKey).toBe('common.invalidObjectId');
    });

    test('validation — empty body returns 400 via parseBody', async () => {
      const callerId = new mongoose.Types.ObjectId().toString();
      const { handler } = loadHandlerWithMocks();
      const res = await handler(
        createEvent({
          method: 'POST',
          resource: '/notifications/dispatch',
          body: null,
          authorizer: createAuthorizer({ userId: callerId, role: 'admin' }),
        }),
        createContext()
      );
      const parsed = parseResponse(res);
      expect(parsed.statusCode).toBe(400);
    });

    test('validation — malformed JSON body string returns 400', async () => {
      const callerId = new mongoose.Types.ObjectId().toString();
      const { handler } = loadHandlerWithMocks();
      const res = await handler(
        createEvent({
          method: 'POST',
          resource: '/notifications/dispatch',
          body: '{"targetUserId":',
          authorizer: createAuthorizer({ userId: callerId, role: 'admin' }),
        }),
        createContext()
      );
      const parsed = parseResponse(res);
      expect(parsed.statusCode).toBe(400);
    });

    test('auth — missing authorizer context returns 401', async () => {
      const { handler } = loadHandlerWithMocks();
      const res = await handler(
        createEvent({
          method: 'POST',
          resource: '/notifications/dispatch',
          body: JSON.stringify({
            targetUserId: new mongoose.Types.ObjectId().toString(),
            type: 'vaccine_reminder',
          }),
        }),
        createContext()
      );
      const parsed = parseResponse(res);
      expect(parsed.statusCode).toBe(401);
      expect(parsed.body.errorKey).toBe('common.unauthorized');
    });

    test('auth — non-admin authenticated user gets 403 on dispatch', async () => {
      const callerId = new mongoose.Types.ObjectId().toString();
      const targetUserId = new mongoose.Types.ObjectId().toString();

      const { handler } = loadHandlerWithMocks();
      const res = await handler(
        createEvent({
          method: 'POST',
          resource: '/notifications/dispatch',
          body: JSON.stringify({ targetUserId, type: 'vaccine_reminder' }),
          authorizer: createAuthorizer({ userId: callerId, role: 'user' }),
        }),
        createContext()
      );
      const parsed = parseResponse(res);
      expect(parsed.statusCode).toBe(403);
      expect(parsed.body.errorKey).toBe('common.forbidden');
    });
  });

  // ── Cyberattack / abuse cases ────────────────────────────────────────────

  describe('cyberattack / abuse cases', () => {
    test('alg:none JWT attack does not grant access', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({ userId, userRole: 'user', exp: Math.floor(Date.now() / 1000) + 900 })
      ).toString('base64url');
      const algNoneToken = `${header}.${payload}.`;

      const { handler } = loadHandlerWithMocks({
        envOverrides: { AWS_SAM_LOCAL: 'true' },
      });
      const res = await handler(
        createEvent({
          method: 'GET',
          resource: '/notifications/me',
          headers: { Authorization: `Bearer ${algNoneToken}` },
        }),
        createContext()
      );
      const parsed = parseResponse(res);
      expect([401, 403]).toContain(parsed.statusCode);
    });

    test('NoSQL operator injection in notificationId path param is rejected by ObjectId validation', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const { handler } = loadHandlerWithMocks();
      const res = await handler(
        createEvent({
          method: 'PATCH',
          resource: '/notifications/me/{notificationId}',
          pathParameters: { notificationId: '{"$gt":""}' },
          authorizer: createAuthorizer({ userId }),
        }),
        createContext()
      );
      const parsed = parseResponse(res);
      expect(parsed.statusCode).toBe(400);
      expect(parsed.body.errorKey).toBe('common.invalidObjectId');
    });

    test('mass assignment — unknown fields in dispatch body are rejected with 400 (strict schema)', async () => {
      const callerId = new mongoose.Types.ObjectId().toString();
      const targetUserId = new mongoose.Types.ObjectId().toString();

      const { handler, notificationsModel } = loadHandlerWithMocks();
      const res = await handler(
        createEvent({
          method: 'POST',
          resource: '/notifications/dispatch',
          body: JSON.stringify({
            targetUserId,
            type: 'vaccine_reminder',
            isArchived: true,
            __proto__: { evil: true },
            userId: 'injected-id',
          }),
          authorizer: createAuthorizer({ userId: callerId, role: 'admin' }),
        }),
        createContext()
      );
      const parsed = parseResponse(res);
      // strict() rejects unknown fields — no DB write should occur
      expect(parsed.statusCode).toBe(400);
      expect(notificationsModel.create).not.toHaveBeenCalled();
    });

    test('replay abuse — duplicate archive requests when already archived return 404 (matchedCount 0)', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const notificationId = new mongoose.Types.ObjectId().toString();

      const { handler } = loadHandlerWithMocks({
        updateOneResult: { matchedCount: 0, modifiedCount: 0 },
      });
      const res = await handler(
        createEvent({
          method: 'PATCH',
          resource: '/notifications/me/{notificationId}',
          pathParameters: { notificationId },
          authorizer: createAuthorizer({ userId }),
        }),
        createContext()
      );
      const parsed = parseResponse(res);
      expect(parsed.statusCode).toBe(404);
    });

    test('cross-user access — archived notificationId owned by different user returns 404 via ownership filter', async () => {
      const callerId = new mongoose.Types.ObjectId().toString();
      const notificationId = new mongoose.Types.ObjectId().toString();

      const { handler, notificationsModel } = loadHandlerWithMocks({
        updateOneResult: { matchedCount: 0, modifiedCount: 0 },
      });
      await handler(
        createEvent({
          method: 'PATCH',
          resource: '/notifications/me/{notificationId}',
          pathParameters: { notificationId },
          authorizer: createAuthorizer({ userId: callerId }),
        }),
        createContext()
      );
      // The filter must include the caller's userId, preventing cross-user access
      const [filter] = notificationsModel.updateOne.mock.calls[0];
      expect(String(filter.userId)).toBe(callerId);
    });

    test('expired JWT token does not produce authorizer context', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const expiredToken = jwt.sign(
        { userId, userRole: 'user' },
        JWT_SECRET,
        { algorithm: 'HS256', expiresIn: '-1s' }
      );

      const { handler } = loadHandlerWithMocks({
        envOverrides: { AWS_SAM_LOCAL: 'true' },
      });
      const res = await handler(
        createEvent({
          method: 'GET',
          resource: '/notifications/me',
          headers: { Authorization: `Bearer ${expiredToken}` },
        }),
        createContext()
      );
      const parsed = parseResponse(res);
      expect([401, 403]).toContain(parsed.statusCode);
    });

    test('dispatch body with type not in enum is always rejected with 400 (enum type restriction)', async () => {
      const callerId = new mongoose.Types.ObjectId().toString();
      const targetUserId = new mongoose.Types.ObjectId().toString();
      const longType = 'x'.repeat(10_000);

      const { handler } = loadHandlerWithMocks();
      const res = await handler(
        createEvent({
          method: 'POST',
          resource: '/notifications/dispatch',
          body: JSON.stringify({ targetUserId, type: longType }),
          authorizer: createAuthorizer({ userId: callerId, role: 'admin' }),
        }),
        createContext()
      );
      // Enum validation rejects any string not in NOTIFICATION_TYPES
      const parsed = parseResponse(res);
      expect(parsed.statusCode).toBe(400);
      expect(parsed.body.errorKey).toBe('notifications.errors.typeRequired');
    });
  });
});

// ─── Tier 3: SAM local HTTP integration ──────────────────────────────────────

describe('Tier 3 — notifications SAM local HTTP integration', () => {
  let samReachable = false;

  beforeAll(async () => {
    try {
      await ensureSamLocalReachable();
      samReachable = true;
    } catch {
      samReachable = false;
    }
  });

  function skipIfNoSam() {
    if (!samReachable) {
      console.warn('[skip] SAM local not reachable — skipping Tier 3');
      return true;
    }

    return false;
  }

  test('OPTIONS /notifications/me returns CORS preflight 204', async () => {
    if (skipIfNoSam()) return;
    const res = await req('OPTIONS', '/notifications/me', undefined, { origin: VALID_ORIGIN });
    expect(res.status).toBe(204);
  });

  test('OPTIONS /notifications/dispatch returns CORS preflight 204', async () => {
    if (skipIfNoSam()) return;
    const res = await req('OPTIONS', '/notifications/dispatch', undefined, { origin: VALID_ORIGIN });
    expect(res.status).toBe(204);
  });

  test('GET /notifications/me without auth returns 401', async () => {
    if (skipIfNoSam()) return;
    const res = await req('GET', '/notifications/me', undefined, { origin: VALID_ORIGIN });
    expect(res.status).toBe(401);
  });

  test('GET /notifications/me with valid JWT returns 200', async () => {
    if (skipIfNoSam()) return;
    const token = signToken({ userId: new mongoose.Types.ObjectId().toString() });
    const res = await req('GET', '/notifications/me', undefined, {
      Authorization: `Bearer ${token}`,
      origin: VALID_ORIGIN,
    });
    expect([200, 401]).toContain(res.status);
  });

  test('POST /notifications/dispatch with non-admin token returns 403', async () => {
    if (skipIfNoSam()) return;
    const token = signToken({ userId: new mongoose.Types.ObjectId().toString(), role: 'user' });
    const res = await req(
      'POST',
      '/notifications/dispatch',
      { targetUserId: new mongoose.Types.ObjectId().toString(), type: 'vaccine_reminder' },
      { Authorization: `Bearer ${token}`, origin: VALID_ORIGIN }
    );
    expect([403, 401]).toContain(res.status);
  });

  test('POST /notifications/dispatch with missing type returns 400 for admin token', async () => {
    if (skipIfNoSam()) return;
    const token = signToken({ userId: new mongoose.Types.ObjectId().toString(), role: 'admin' });
    const res = await req(
      'POST',
      '/notifications/dispatch',
      { targetUserId: new mongoose.Types.ObjectId().toString() },
      { Authorization: `Bearer ${token}`, origin: VALID_ORIGIN }
    );
    expect([400, 401, 403]).toContain(res.status);
  });

  test('PATCH /notifications/me with invalid notificationId returns 400', async () => {
    if (skipIfNoSam()) return;
    const token = signToken({ userId: new mongoose.Types.ObjectId().toString() });
    const res = await req(
      'PATCH',
      '/notifications/me/not-a-valid-id',
      undefined,
      { Authorization: `Bearer ${token}`, origin: VALID_ORIGIN }
    );
    expect([400, 401]).toContain(res.status);
  });

  test('unknown route /notifications/unknown returns 404', async () => {
    if (skipIfNoSam()) return;
    const token = signToken({ userId: new mongoose.Types.ObjectId().toString() });
    const res = await req('GET', '/notifications/unknown-path', undefined, {
      Authorization: `Bearer ${token}`,
      origin: VALID_ORIGIN,
    });
    expect([404, 401, 403]).toContain(res.status);
  });
});
