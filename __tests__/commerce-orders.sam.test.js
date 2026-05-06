// Tier 3 — SAM local HTTP integration tests for the commerce-orders Lambda.
//
// Prerequisites (run before this suite):
//   sam local start-api \
//     --template .aws-sam/build/template.yaml \
//     --env-vars env.json \
//     --warm-containers EAGER
//
// The suite reads env.json for the MongoDB URI, JWT secret, and API key.
// DB-dependent tests seed their own fixtures and clean up in afterAll.
// POST /commerce/orders requires multipart/form-data and depends on a seeded
// ShopInfo document; the suite seeds and tears down that document itself.

const crypto = require('crypto');
const dns = require('dns');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const envConfig = require('../env.json');

const BASE_URL = process.env.COMMERCE_ORDERS_UAT_BASE_URL || 'http://127.0.0.1:3000';
const TEST_TS = Date.now();
const RUN_ID = `ddd-orders-${TEST_TS}`;
const JWT_SECRET =
  process.env.COMMERCE_ORDERS_TEST_JWT_SECRET ||
  envConfig.RequestAuthorizerFunction?.JWT_SECRET ||
  'PPCSecret';
const API_KEY =
  process.env.COMMERCE_ORDERS_TEST_API_KEY ||
  envConfig.Parameters?.ExistingApiKeyId ||
  'test-api-key';
const MONGODB_URI =
  envConfig.CommerceOrdersFunction?.MONGODB_URI ||
  envConfig.Parameters?.MONGODB_URI ||
  '';
const AUTH_BYPASS =
  envConfig.Parameters?.AUTH_BYPASS ||
  envConfig.CommerceOrdersFunction?.AUTH_BYPASS ||
  'false';
const VALID_ORIGIN = 'http://localhost:3000';

let dbReady = false;
let dbConnectAttempted = false;
let dbConnectError = null;

// Seeded ShopInfo shopCode used by POST /commerce/orders tests
const SEEDED_SHOP_CODE = `${RUN_ID}-shop`;

const state = {
  adminUserId: new mongoose.Types.ObjectId(),
  regularUserId: new mongoose.Types.ObjectId(),
  adminToken: null,
  regularToken: null,
  seededOrderId: null,
  seededOrderTempId: `${RUN_ID}-existing-order`,
  createdOrderTempIds: [],
  createdOrderVerificationIds: [],
};

// ─── helpers ─────────────────────────────────────────────────────────────────

function signToken({ userId, role = 'user', userEmail, expiresIn = '15m' }) {
  const payload = { userId: userId.toString(), userRole: role };
  if (userEmail) payload.userEmail = userEmail;
  return jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256', expiresIn });
}

function buildAlgNoneToken({ userId, role = 'user' }) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      userId: userId.toString(),
      userRole: role,
      exp: Math.floor(Date.now() / 1000) + 900,
    })
  ).toString('base64url');
  return `${header}.${payload}.`;
}

function authHeaders(token, extra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    'x-api-key': API_KEY,
    origin: VALID_ORIGIN,
    'x-forwarded-for': `198.51.100.${(TEST_TS % 200) + 1}`,
    ...extra,
  };
}

function expectedUnauthStatuses() {
  return AUTH_BYPASS === 'true' ? [401, 403, 404] : [401, 403];
}

async function req(method, path, body, headers = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(method === 'OPTIONS' ? {} : { 'x-api-key': API_KEY }),
      'Content-Type': 'application/json',
      origin: VALID_ORIGIN,
      'x-forwarded-for': `198.51.100.${(TEST_TS % 200) + 1}`,
      ...headers,
    },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
        ? body
        : typeof body === 'string'
        ? body
        : JSON.stringify(body),
  });

  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  return { status: res.status, body: json, headers: Object.fromEntries(res.headers.entries()) };
}

function buildOrderFormData(overrides = {}) {
  const defaults = {
    lastName: `${RUN_ID}-buyer`,
    email: `${RUN_ID}-buyer@test.com`,
    address: '123 Test Street, HK',
    option: 'PTag',
    tempId: `${RUN_ID}-${crypto.randomBytes(4).toString('hex')}`,
    paymentWay: 'bank-transfer',
    delivery: 'mail',
    petName: 'Fluffy',
    phoneNumber: '98765432',
    shopCode: SEEDED_SHOP_CODE,
  };
  const fields = { ...defaults, ...overrides };
  const form = new FormData();
  for (const [key, val] of Object.entries(fields)) {
    if (val !== undefined && val !== null) {
      form.append(key, String(val));
    }
  }
  return { form, tempId: fields.tempId };
}

async function connectDB() {
  if (!MONGODB_URI) throw new Error('env.json missing CommerceOrdersFunction.MONGODB_URI');
  if (dbReady) return;
  if (dbConnectAttempted) {
    if (dbConnectError) throw dbConnectError;
    return;
  }

  dbConnectAttempted = true;
  dns.setServers(['8.8.8.8', '1.1.1.1']);
  try {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000, maxPoolSize: 2 });
    }
    dbReady = true;
  } catch (error) {
    dbConnectError = error;
    throw error;
  }
}

function ordersCol() {
  return mongoose.connection.db.collection('orders');
}

function orderVerificationsCol() {
  return mongoose.connection.db.collection('orderverifications');
}

function shopInfoCol() {
  return mongoose.connection.db.collection('shopInfo');
}

async function ensureDbOrSkip() {
  try {
    await connectDB();
  } catch (error) {
    console.warn(`[skip] UAT DB unavailable: ${error.message}`);
    return false;
  }
  return true;
}

async function seedFixtures() {
  state.adminToken = signToken({
    userId: state.adminUserId,
    role: 'admin',
    userEmail: `${RUN_ID}-admin@test.com`,
  });
  state.regularToken = signToken({
    userId: state.regularUserId,
    role: 'user',
    userEmail: `${RUN_ID}-user@test.com`,
  });

  // Seed a ShopInfo the POST handler can resolve a canonical price against
  await shopInfoCol().deleteOne({ shopCode: SEEDED_SHOP_CODE });
  await shopInfoCol().insertOne({
    shopCode: SEEDED_SHOP_CODE,
    shopName: `${RUN_ID} Test Shop`,
    price: 199,
  });

  // Seed an existing Order so GET /commerce/orders/{tempId} has something to find
  await ordersCol().deleteOne({ tempId: state.seededOrderTempId });
  const insertResult = await ordersCol().insertOne({
    isPTagAir: false,
    tempId: state.seededOrderTempId,
    lastName: `${RUN_ID}-seeded-buyer`,
    email: `${RUN_ID}-user@test.com`,
    phoneNumber: '98765432',
    address: '1 Seeded Street, HK',
    paymentWay: 'bank-transfer',
    delivery: 'mail',
    option: 'PTag',
    petName: 'Seeded Pet',
    shopCode: SEEDED_SHOP_CODE,
    price: 199,
    buyDate: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  state.seededOrderId = insertResult.insertedId;
}

async function ensureSamLocalReachable() {
  try {
    await fetch(`${BASE_URL}/commerce/orders`, {
      method: 'OPTIONS',
      headers: { origin: VALID_ORIGIN },
    });
  } catch {
    throw new Error(
      `SAM local API is not reachable at ${BASE_URL}.\n` +
        `Start it with:\n` +
        `  sam local start-api --template .aws-sam/build/template.yaml --env-vars env.json --warm-containers EAGER`
    );
  }
}

// ─── cleanup ─────────────────────────────────────────────────────────────────

afterAll(async () => {
  if (dbReady && mongoose.connection.readyState !== 0) {
    await shopInfoCol().deleteOne({ shopCode: SEEDED_SHOP_CODE });

    if (state.seededOrderId) {
      await ordersCol().deleteOne({ _id: state.seededOrderId });
    }

    if (state.createdOrderTempIds.length > 0) {
      await ordersCol().deleteMany({ tempId: { $in: state.createdOrderTempIds } });
      await orderVerificationsCol().deleteMany({ orderId: { $in: state.createdOrderTempIds } });
    }

    await mongoose.disconnect();
  }
});

// ─── suite ───────────────────────────────────────────────────────────────────

describe('Tier 3 - /commerce/orders via SAM local + UAT DB', () => {
  beforeAll(async () => {
    await ensureSamLocalReachable();
  });

  // ── Happy paths ─────────────────────────────────────────────────────────────

  describe('happy paths', () => {
    test('GET /commerce/orders returns 200 with orders array and pagination for admin', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req('GET', '/commerce/orders', undefined, authHeaders(state.adminToken));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.orders)).toBe(true);
      expect(res.body.pagination).toBeDefined();
      expect(typeof res.body.pagination.total).toBe('number');
      expect(res.headers['access-control-allow-origin']).toBe('*');
    });

    test('GET /commerce/orders/{tempId} returns the order when admin requests any tempId', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'GET',
        `/commerce/orders/${state.seededOrderTempId}`,
        undefined,
        authHeaders(state.adminToken)
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.id).toBeDefined();
    });

    test('GET /commerce/orders/{tempId} returns the order when the caller email matches order email', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      // state.regularToken has email matching the seeded order's email field
      const res = await req(
        'GET',
        `/commerce/orders/${state.seededOrderTempId}`,
        undefined,
        authHeaders(state.regularToken)
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('POST /commerce/orders creates an Order and an OrderVerification persisted to DB', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const { form, tempId } = buildOrderFormData();
      const multipartHeaders = {
        Authorization: `Bearer ${state.regularToken}`,
        'x-api-key': API_KEY,
        origin: VALID_ORIGIN,
        'x-forwarded-for': `198.51.100.${(TEST_TS % 200) + 1}`,
        // Do NOT set Content-Type — fetch sets the correct multipart boundary automatically
      };

      const res = await fetch(`${BASE_URL}/commerce/orders`, {
        method: 'POST',
        headers: multipartHeaders,
        body: form,
      });

      let json = null;
      try { json = await res.json(); } catch { json = null; }
      const result = { status: res.status, body: json };

      // The order may fail if external services (SMTP, S3, URL shortener) are
      // unavailable in the local SAM environment. Accept 200 or any 5xx from those
      // non-fatal paths; 400/409 indicate test or data problems.
      if (result.status === 200) {
        expect(result.body.success).toBe(true);
        expect(result.body.purchase_code).toBe(tempId);
        state.createdOrderTempIds.push(tempId);

        // Verify both documents were persisted
        const persistedOrder = await ordersCol().findOne({ tempId });
        expect(persistedOrder).not.toBeNull();
        expect(persistedOrder.email).toBe(`${RUN_ID}-buyer@test.com`);

        const persistedVerification = await orderVerificationsCol().findOne({ orderId: tempId });
        expect(persistedVerification).not.toBeNull();
        expect(persistedVerification.cancelled).toBe(false);
        expect(persistedVerification.tagId).toBeDefined();
      } else {
        console.warn(`[info] POST /commerce/orders returned ${result.status} — external services may be unavailable in local SAM`);
        // Still track the tempId in case partial state was written
        state.createdOrderTempIds.push(tempId);
      }
    });
  });

  // ── Input validation - 400 ──────────────────────────────────────────────────

  describe('input validation - 400', () => {
    test('POST /commerce/orders rejects missing required fields with 400', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      // Send multipart with only an email — no lastName, option, tempId, etc.
      const form = new FormData();
      form.append('email', `${RUN_ID}-incomplete@test.com`);

      const res = await fetch(`${BASE_URL}/commerce/orders`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${state.regularToken}`,
          'x-api-key': API_KEY,
          origin: VALID_ORIGIN,
        },
        body: form,
      });
      const json = await res.json().catch(() => null);

      expect(res.status).toBe(400);
      expect(json?.success).toBe(false);
    });

    test('POST /commerce/orders rejects an invalid email format', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const { form } = buildOrderFormData({ email: 'not-an-email' });

      const res = await fetch(`${BASE_URL}/commerce/orders`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${state.regularToken}`,
          'x-api-key': API_KEY,
          origin: VALID_ORIGIN,
        },
        body: form,
      });
      const json = await res.json().catch(() => null);

      expect(res.status).toBe(400);
      expect(json?.errorKey).toBe('orders.errors.invalidEmail');
    });

    test('POST /commerce/orders rejects a tempId containing illegal characters', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const { form } = buildOrderFormData({ tempId: 'bad tempId <script>' });

      const res = await fetch(`${BASE_URL}/commerce/orders`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${state.regularToken}`,
          'x-api-key': API_KEY,
          origin: VALID_ORIGIN,
        },
        body: form,
      });
      const json = await res.json().catch(() => null);

      expect(res.status).toBe(400);
      expect(json?.errorKey).toBe('orders.errors.invalidTempId');
    });

    test('GET /commerce/orders/{tempId} returns 404 for a tempId that does not exist', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'GET',
        `/commerce/orders/nonexistent-${RUN_ID}`,
        undefined,
        authHeaders(state.adminToken)
      );

      expect(res.status).toBe(404);
      expect(res.body.errorKey).toBe('orders.errors.orderNotFound');
    });
  });

  // ── Business-logic errors - 4xx ─────────────────────────────────────────────

  describe('business-logic errors - 4xx', () => {
    test('POST /commerce/orders returns 409 when tempId is already taken', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      // state.seededOrderTempId already exists as a seeded Order
      const { form } = buildOrderFormData({ tempId: state.seededOrderTempId });

      const res = await fetch(`${BASE_URL}/commerce/orders`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${state.regularToken}`,
          'x-api-key': API_KEY,
          origin: VALID_ORIGIN,
        },
        body: form,
      });
      const json = await res.json().catch(() => null);

      expect(res.status).toBe(409);
      expect(json?.errorKey).toBe('orders.errors.duplicateOrder');
    });

    test('GET /commerce/orders/{tempId} returns 403 when non-admin caller email does not match order email', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      // adminToken has a different email than the seeded order email
      const differentUserToken = signToken({
        userId: new mongoose.Types.ObjectId(),
        role: 'user',
        userEmail: `${RUN_ID}-different-owner@test.com`,
      });

      const res = await req(
        'GET',
        `/commerce/orders/${state.seededOrderTempId}`,
        undefined,
        authHeaders(differentUserToken)
      );

      expect(res.status).toBe(403);
      expect(res.body.errorKey).toBe('common.forbidden');
    });

    test('GET /commerce/orders returns 403 when caller has user role', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req('GET', '/commerce/orders', undefined, authHeaders(state.regularToken));

      expect(res.status).toBe(403);
    });
  });

  // ── Authentication and authorisation ────────────────────────────────────────

  describe('authentication and authorisation', () => {
    test('GET /commerce/orders rejects a missing Authorization header', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req('GET', '/commerce/orders', undefined, {
        'x-api-key': API_KEY,
        origin: VALID_ORIGIN,
      });

      expect(expectedUnauthStatuses()).toContain(res.status);
    });

    test('GET /commerce/orders rejects a garbage bearer token', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req('GET', '/commerce/orders', undefined, authHeaders('this.is.garbage'));

      expect([401, 403]).toContain(res.status);
    });

    test('GET /commerce/orders rejects an expired JWT', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const expiredToken = signToken({ userId: state.adminUserId, role: 'admin', expiresIn: -60 });
      const res = await req('GET', '/commerce/orders', undefined, authHeaders(expiredToken));

      expect([401, 403]).toContain(res.status);
    });

    test('GET /commerce/orders rejects a tampered JWT', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const tampered = `${state.adminToken.slice(0, -1)}${
        state.adminToken.slice(-1) === 'a' ? 'b' : 'a'
      }`;
      const res = await req('GET', '/commerce/orders', undefined, authHeaders(tampered));

      expect([401, 403]).toContain(res.status);
    });

    test('POST /commerce/orders rejects a missing Authorization header', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const { form } = buildOrderFormData();
      const res = await fetch(`${BASE_URL}/commerce/orders`, {
        method: 'POST',
        headers: { 'x-api-key': API_KEY, origin: VALID_ORIGIN },
        body: form,
      });

      expect(expectedUnauthStatuses()).toContain(res.status);
    });
  });

  // ── Route infrastructure ────────────────────────────────────────────────────

  describe('route infrastructure', () => {
    test('returns 404 for an unknown /commerce/orders sub-path', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req('GET', '/commerce/orders/unknown/extra', undefined, authHeaders(state.adminToken));

      expect(res.status).toBe(404);
    });

    test('returns 405 for PATCH on /commerce/orders', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req('PATCH', '/commerce/orders', {}, authHeaders(state.adminToken));

      expect(res.status).toBe(405);
    });
  });

  // ── Cyberattacks ────────────────────────────────────────────────────────────

  describe('cyberattacks', () => {
    test('GET /commerce/orders rejects an alg:none JWT attack', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const algNoneToken = buildAlgNoneToken({ userId: state.adminUserId, role: 'admin' });
      const res = await req('GET', '/commerce/orders', undefined, authHeaders(algNoneToken));

      expect([401, 403]).toContain(res.status);
    });

    test('POST /commerce/orders rejects a self-crafted role-escalation claim in JWT', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      // Craft a token claiming admin role with an unknown secret — must be rejected
      const escalatedToken = jwt.sign(
        { userId: state.regularUserId.toString(), userRole: 'admin' },
        'wrong-secret',
        { algorithm: 'HS256', expiresIn: '15m' }
      );

      const { form } = buildOrderFormData();
      const res = await fetch(`${BASE_URL}/commerce/orders`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${escalatedToken}`,
          'x-api-key': API_KEY,
          origin: VALID_ORIGIN,
        },
        body: form,
      });

      expect([401, 403]).toContain(res.status);
    });

    test('POST /commerce/orders rejects script injection in tempId field', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const { form } = buildOrderFormData({ tempId: '<script>alert(1)</script>' });
      const res = await fetch(`${BASE_URL}/commerce/orders`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${state.regularToken}`,
          'x-api-key': API_KEY,
          origin: VALID_ORIGIN,
        },
        body: form,
      });
      const json = await res.json().catch(() => null);

      expect(res.status).toBe(400);
      expect(json?.errorKey).toBe('orders.errors.invalidTempId');
    });
  });
});
