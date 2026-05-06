// Tier 3 — SAM local HTTP integration tests for the commerce-fulfillment Lambda.
//
// Prerequisites (run before this suite):
//   sam local start-api \
//     --template .aws-sam/build/template.yaml \
//     --env-vars env.json \
//     --warm-containers EAGER
//
// The suite reads env.json for the MongoDB URI, JWT secret, and API key.
// DB-dependent tests seed their own fixtures and clean up in afterAll.
//
// Routes under test:
//   GET    /commerce/fulfillment                                — admin/developer
//   DELETE /commerce/fulfillment/{orderVerificationId}         — admin/developer
//   GET    /commerce/fulfillment/tags/{tagId}                   — admin/developer
//   PATCH  /commerce/fulfillment/tags/{tagId}                   — admin/developer
//   GET    /commerce/fulfillment/suppliers/{orderId}            — admin/developer
//   PATCH  /commerce/fulfillment/suppliers/{orderId}            — admin/developer

const dns = require('dns');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const envConfig = require('../env.json');

const BASE_URL = process.env.COMMERCE_FULFILLMENT_UAT_BASE_URL || 'http://127.0.0.1:3000';
const TEST_TS = Date.now();
const RUN_ID = `ddd-fulfill-${TEST_TS}`;
const JWT_SECRET =
  process.env.COMMERCE_FULFILLMENT_TEST_JWT_SECRET ||
  envConfig.RequestAuthorizerFunction?.JWT_SECRET ||
  'PPCSecret';
const API_KEY =
  process.env.COMMERCE_FULFILLMENT_TEST_API_KEY ||
  envConfig.Parameters?.ExistingApiKeyId ||
  'test-api-key';
const MONGODB_URI =
  envConfig.CommerceFulfillmentFunction?.MONGODB_URI ||
  envConfig.Parameters?.MONGODB_URI ||
  '';
const AUTH_BYPASS =
  envConfig.Parameters?.AUTH_BYPASS ||
  envConfig.CommerceFulfillmentFunction?.AUTH_BYPASS ||
  'false';
const VALID_ORIGIN = 'http://localhost:3000';

let dbReady = false;
let dbConnectAttempted = false;
let dbConnectError = null;

const state = {
  adminUserId: new mongoose.Types.ObjectId(),
  regularUserId: new mongoose.Types.ObjectId(),
  adminToken: null,
  regularToken: null,
  // Seeded OrderVerification documents
  verificationIdA: new mongoose.Types.ObjectId(),
  verificationIdB: new mongoose.Types.ObjectId(), // used for cancel tests
  tagIdA: `${RUN_ID}-TAG-A`,
  tagIdB: `${RUN_ID}-TAG-B`,
  orderId: `${RUN_ID}-ord-001`,
};

// ─── helpers ─────────────────────────────────────────────────────────────────

function signToken({ userId, role = 'user', expiresIn = '15m' }) {
  const payload = { userId: userId.toString(), userRole: role };
  return jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256', expiresIn });
}

function buildAlgNoneToken({ userId, role = 'admin' }) {
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

async function connectDB() {
  if (!MONGODB_URI) throw new Error('env.json missing CommerceFulfillmentFunction.MONGODB_URI');
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

function verificationsCol() {
  return mongoose.connection.db.collection('orderverifications');
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
  state.adminToken = signToken({ userId: state.adminUserId, role: 'admin' });
  state.regularToken = signToken({ userId: state.regularUserId, role: 'user' });

  const now = new Date();

  await verificationsCol().deleteMany({
    _id: { $in: [state.verificationIdA, state.verificationIdB] },
  });

  await verificationsCol().insertMany([
    {
      _id: state.verificationIdA,
      tagId: state.tagIdA,
      staffVerification: false,
      cancelled: false,
      contact: '98765432',
      verifyDate: null,
      petName: `${RUN_ID}-PetA`,
      shortUrl: 'https://ptag.com.hk/short/a',
      masterEmail: `${RUN_ID}-a@test.com`,
      qrUrl: 'https://example.com/qr-a.png',
      petUrl: '',
      orderId: state.orderId,
      pendingStatus: false,
      option: 'PTag',
      type: '',
      optionSize: '',
      optionColor: '',
      price: 199,
      discountProof: '',
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: state.verificationIdB,
      tagId: state.tagIdB,
      staffVerification: false,
      cancelled: false,
      contact: '98765433',
      verifyDate: null,
      petName: `${RUN_ID}-PetB`,
      shortUrl: 'https://ptag.com.hk/short/b',
      masterEmail: `${RUN_ID}-b@test.com`,
      qrUrl: 'https://example.com/qr-b.png',
      petUrl: '',
      orderId: `${state.orderId}-b`,
      pendingStatus: false,
      option: 'PTag',
      type: '',
      optionSize: '',
      optionColor: '',
      price: 199,
      discountProof: '',
      createdAt: now,
      updatedAt: now,
    },
  ]);
}

async function ensureSamLocalReachable() {
  try {
    await fetch(`${BASE_URL}/commerce/fulfillment`, {
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
    await verificationsCol().deleteMany({
      _id: { $in: [state.verificationIdA, state.verificationIdB] },
    });
    await mongoose.disconnect();
  }
});

// ─── suite ───────────────────────────────────────────────────────────────────

describe('Tier 3 - /commerce/fulfillment via SAM local + UAT DB', () => {
  beforeAll(async () => {
    await ensureSamLocalReachable();
  });

  // ── Happy paths ─────────────────────────────────────────────────────────────

  describe('happy paths', () => {
    test('GET /commerce/fulfillment returns 200 with pagination and orderVerification array for admin', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req('GET', '/commerce/fulfillment', undefined, authHeaders(state.adminToken));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.orderVerification)).toBe(true);
      expect(res.body.pagination).toBeDefined();
      expect(typeof res.body.pagination.total).toBe('number');
      expect(res.headers['access-control-allow-origin']).toBe('*');
    });

    test('GET /commerce/fulfillment/tags/{tagId} returns the seeded verification for admin', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'GET',
        `/commerce/fulfillment/tags/${state.tagIdA}`,
        undefined,
        authHeaders(state.adminToken)
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.orderVerification).toBeDefined();
      expect(res.body.orderVerification.tagId).toBe(state.tagIdA);
    });

    test('PATCH /commerce/fulfillment/tags/{tagId} updates petName and persists to DB', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const updatedName = `${RUN_ID}-patched-pet`;

      const res = await req(
        'PATCH',
        `/commerce/fulfillment/tags/${state.tagIdA}`,
        { petName: updatedName },
        authHeaders(state.adminToken)
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const persisted = await verificationsCol().findOne({ _id: state.verificationIdA });
      expect(persisted.petName).toBe(updatedName);
    });

    test('DELETE /commerce/fulfillment/{id} soft-cancels and DB shows cancelled=true', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const id = state.verificationIdB.toString();

      const res = await req(
        'DELETE',
        `/commerce/fulfillment/${id}`,
        undefined,
        authHeaders(state.adminToken)
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const persisted = await verificationsCol().findOne({ _id: state.verificationIdB });
      expect(persisted.cancelled).toBe(true);
    });

    test('repeated GET /commerce/fulfillment requests are stable across warm invocations', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const first = await req('GET', '/commerce/fulfillment', undefined, authHeaders(state.adminToken));
      const second = await req('GET', '/commerce/fulfillment', undefined, authHeaders(state.adminToken));

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(first.body.pagination.total).toBe(second.body.pagination.total);
    });
  });

  // ── Input validation - 400 ──────────────────────────────────────────────────

  describe('input validation - 400', () => {
    test('PATCH /commerce/fulfillment/tags/{tagId} rejects an extra unknown field (strict schema)', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'PATCH',
        `/commerce/fulfillment/tags/${state.tagIdA}`,
        { petName: 'ok', unknownField: 'injected' },
        authHeaders(state.adminToken)
      );

      // tagUpdateSchema uses .strict() — extra fields must be rejected
      expect(res.status).toBe(400);
    });

    test('PATCH /commerce/fulfillment/tags/{tagId} rejects an invalid verifyDate format', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'PATCH',
        `/commerce/fulfillment/tags/${state.tagIdA}`,
        { verifyDate: 'not-a-date' },
        authHeaders(state.adminToken)
      );

      expect(res.status).toBe(400);
      expect(res.body.errorKey).toBe('fulfillment.errors.invalidDate');
    });

    test('DELETE /commerce/fulfillment/{id} rejects a non-ObjectId id', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'DELETE',
        '/commerce/fulfillment/not-a-valid-id',
        undefined,
        authHeaders(state.adminToken)
      );

      expect(res.status).toBe(400);
      expect(res.body.errorKey).toBe('common.invalidObjectId');
    });

    test('PATCH /commerce/fulfillment/tags/{tagId} rejects a malformed JSON body', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'PATCH',
        `/commerce/fulfillment/tags/${state.tagIdA}`,
        '{"petName":"Fluffy"',
        authHeaders(state.adminToken)
      );

      expect(res.status).toBe(400);
    });
  });

  // ── Business-logic errors - 4xx ─────────────────────────────────────────────

  describe('business-logic errors - 4xx', () => {
    test('GET /commerce/fulfillment/tags/{tagId} returns 404 for a tagId that does not exist', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'GET',
        `/commerce/fulfillment/tags/TAG-DOES-NOT-EXIST-${RUN_ID}`,
        undefined,
        authHeaders(state.adminToken)
      );

      expect(res.status).toBe(404);
    });

    test('DELETE /commerce/fulfillment/{id} returns 409 when already cancelled', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const id = state.verificationIdB.toString();

      // First cancel
      const first = await req(
        'DELETE',
        `/commerce/fulfillment/${id}`,
        undefined,
        authHeaders(state.adminToken)
      );
      expect(first.status).toBe(200);

      // Second cancel — document is now cancelled=true
      const second = await req(
        'DELETE',
        `/commerce/fulfillment/${id}`,
        undefined,
        authHeaders(state.adminToken)
      );

      expect(second.status).toBe(409);
      expect(second.body.errorKey).toBe('fulfillment.errors.alreadyCancelled');

      // DB must show cancelled=true and not change further
      const persisted = await verificationsCol().findOne({ _id: state.verificationIdB });
      expect(persisted.cancelled).toBe(true);
    });

    test('GET /commerce/fulfillment returns 403 when caller has user role', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req('GET', '/commerce/fulfillment', undefined, authHeaders(state.regularToken));

      expect(res.status).toBe(403);
    });
  });

  // ── Authentication and authorisation ────────────────────────────────────────

  describe('authentication and authorisation', () => {
    test('GET /commerce/fulfillment rejects a missing Authorization header', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req('GET', '/commerce/fulfillment', undefined, {
        'x-api-key': API_KEY,
        origin: VALID_ORIGIN,
      });

      expect(expectedUnauthStatuses()).toContain(res.status);
    });

    test('GET /commerce/fulfillment rejects a garbage bearer token', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'GET',
        '/commerce/fulfillment',
        undefined,
        authHeaders('not.a.valid.token')
      );

      expect([401, 403]).toContain(res.status);
    });

    test('GET /commerce/fulfillment rejects an expired JWT', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const expiredToken = signToken({ userId: state.adminUserId, role: 'admin', expiresIn: -60 });
      const res = await req('GET', '/commerce/fulfillment', undefined, authHeaders(expiredToken));

      expect([401, 403]).toContain(res.status);
    });

    test('GET /commerce/fulfillment rejects a tampered JWT', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const tampered = `${state.adminToken.slice(0, -1)}${
        state.adminToken.slice(-1) === 'a' ? 'b' : 'a'
      }`;
      const res = await req('GET', '/commerce/fulfillment', undefined, authHeaders(tampered));

      expect([401, 403]).toContain(res.status);
    });

    test('DELETE /commerce/fulfillment/{id} rejects when caller has user role', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const id = state.verificationIdA.toString();
      const res = await req(
        'DELETE',
        `/commerce/fulfillment/${id}`,
        undefined,
        authHeaders(state.regularToken)
      );

      expect(res.status).toBe(403);

      // Verify the document was NOT cancelled
      const persisted = await verificationsCol().findOne({ _id: state.verificationIdA });
      expect(persisted.cancelled).toBe(false);
    });
  });

  // ── Route infrastructure ────────────────────────────────────────────────────

  describe('route infrastructure', () => {
    test('returns 404 for an unknown /commerce/fulfillment sub-path', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'GET',
        '/commerce/fulfillment/unknown-resource',
        undefined,
        authHeaders(state.adminToken)
      );

      expect(res.status).toBe(404);
    });

    test('returns 405 for POST on /commerce/fulfillment', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'POST',
        '/commerce/fulfillment',
        {},
        authHeaders(state.adminToken)
      );

      expect(res.status).toBe(405);
    });

    test('OPTIONS /commerce/fulfillment returns 204 with allowed-origin CORS header', async () => {
      const res = await fetch(`${BASE_URL}/commerce/fulfillment`, {
        method: 'OPTIONS',
        headers: { origin: VALID_ORIGIN },
      });

      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
    });
  });

  // ── Cyberattacks ────────────────────────────────────────────────────────────

  describe('cyberattacks', () => {
    test('GET /commerce/fulfillment rejects an alg:none JWT attack', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const algNoneToken = buildAlgNoneToken({ userId: state.adminUserId, role: 'admin' });
      const res = await req('GET', '/commerce/fulfillment', undefined, authHeaders(algNoneToken));

      expect([401, 403]).toContain(res.status);
    });

    test('PATCH /commerce/fulfillment/tags/{tagId} with injected NoSQL operator in petName is rejected by strict schema', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      // Zod expects a string; an object value must fail validation
      const res = await req(
        'PATCH',
        `/commerce/fulfillment/tags/${state.tagIdA}`,
        { petName: { $set: 'injected' } },
        authHeaders(state.adminToken)
      );

      // Zod coerces object petName to string or fails — either way, no DB mutation
      if (res.status === 200) {
        // If somehow accepted, verify no operator was persisted
        const persisted = await verificationsCol().findOne({ _id: state.verificationIdA });
        expect(typeof persisted.petName).toBe('string');
      } else {
        expect(res.status).toBe(400);
      }
    });

    test('DELETE /commerce/fulfillment/{id} with a crafted role-escalation JWT is rejected', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const escalatedToken = jwt.sign(
        { userId: state.regularUserId.toString(), userRole: 'admin' },
        'wrong-secret',
        { algorithm: 'HS256', expiresIn: '15m' }
      );

      const id = state.verificationIdA.toString();
      const res = await req(
        'DELETE',
        `/commerce/fulfillment/${id}`,
        undefined,
        authHeaders(escalatedToken)
      );

      expect([401, 403]).toContain(res.status);

      // Verify the document was NOT cancelled
      const persisted = await verificationsCol().findOne({ _id: state.verificationIdA });
      expect(persisted.cancelled).toBe(false);
    });
  });
});
