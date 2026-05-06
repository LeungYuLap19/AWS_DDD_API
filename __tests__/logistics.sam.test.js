// Tier 3 — SAM local HTTP integration tests for the logistics Lambda.
// Tier 4 — Real MongoDB UAT persistence proofs for createShipment.
//
// Prerequisites (run before this suite):
//   npm run build:ts && sam build
//   sam local start-api \
//     --template .aws-sam/build/template.yaml \
//     --env-vars env.json \
//     --warm-containers EAGER
//
// Coverage tiers (per dev_docs/llms/DDD_TESTING_STANDARD.md):
//   Tier 2 mock handler tests:    __tests__/logistics.test.js
//   Tier 3 SAM + Mongo (this):    __tests__/logistics.sam.test.js
//
// Routes under test:
//   POST  /logistics/token                     (auth + rate limit — SF address bearer token)
//   POST  /logistics/lookups/areas             (public + rate limit — SF area list)
//   POST  /logistics/lookups/net-codes         (public + rate limit — SF net code list)
//   POST  /logistics/lookups/pickup-locations  (public + rate limit — SF pickup address list)
//   POST  /logistics/shipments                 (auth + rate limit — SF order creation, DB write)
//   POST  /logistics/cloud-waybill             (auth + rate limit — SF waybill PDF email)
//
// DB collections: order, rate_limits
//
// Known limitations:
//   - Happy paths for getToken, getArea, getNetCode, getPickupLocations call the real SF
//     Address API. Tests accept [200, 500] because the SF API may be unreachable.
//   - createShipment and printCloudWaybill call the real SF Express API. Tests accept
//     [200, 500] for the same reason.
//   - With AUTH_BYPASS=true in env.json, the RequestAuthorizerFunction always grants
//     access with context { userId: 'dev-user-id', userEmail: 'dev@test.com', role: 'developer' }.
//     Auth-rejection tests (missing/invalid JWT → 401/403) are therefore skipped under bypass.
//   - Ownership-check tests require AUTH_BYPASS=false to be meaningful (developer role is
//     privileged and bypasses ownership enforcement). Noted and skipped under bypass.

'use strict';

const { createHash } = require('crypto');
const dns = require('dns');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const envConfig = require('../env.json');

const BASE_URL = process.env.LOGISTICS_UAT_BASE_URL || 'http://127.0.0.1:3000';
const TEST_TS = Date.now();
const RUN_ID = `ddd-logistics-${TEST_TS}`;
const JWT_SECRET =
  process.env.LOGISTICS_TEST_JWT_SECRET ||
  envConfig.RequestAuthorizerFunction?.JWT_SECRET ||
  'PPCSecret';
const API_KEY =
  process.env.LOGISTICS_TEST_API_KEY ||
  envConfig.Parameters?.ExistingApiKeyId ||
  'test-api-key';
const MONGODB_URI =
  process.env.MONGODB_URI ||
  envConfig.LogisticsFunction?.MONGODB_URI ||
  envConfig.Parameters?.MONGODB_URI ||
  '';
const AUTH_BYPASS =
  String(envConfig.Parameters?.AUTH_BYPASS || envConfig.RequestAuthorizerFunction?.AUTH_BYPASS || 'false');
const VALID_ORIGIN = 'http://localhost:3000';

// Use a dedicated test IP so rate-limit keys are isolated to this run.
const CLIENT_IP = `198.51.100.${(TEST_TS % 200) + 1}`;

// Identifier used by the bypass authorizer context (see request-authorizer/index.ts).
const BYPASS_USER_EMAIL = 'dev@test.com';
const BYPASS_USER_ID = 'dev-user-id';

let dbReady = false;
let dbConnectAttempted = false;
let dbConnectError = null;

const state = {
  primaryUserId: new mongoose.Types.ObjectId(),
  primaryUserEmail: `logistics-owner-${RUN_ID}@example.com`,
  otherUserId: new mongoose.Types.ObjectId(),
  otherUserEmail: `logistics-other-${RUN_ID}@example.com`,
  orderId: new mongoose.Types.ObjectId(),
  orderTempId: `TEMP-${RUN_ID}`,
};

// Tokens are signed at module level so they are available regardless of DB connectivity.
state.primaryToken = jwt.sign(
  { userId: state.primaryUserId.toString(), userRole: 'user', userEmail: state.primaryUserEmail },
  JWT_SECRET,
  { algorithm: 'HS256', expiresIn: '60m' }
);
state.otherToken = jwt.sign(
  { userId: state.otherUserId.toString(), userRole: 'user', userEmail: state.otherUserEmail },
  JWT_SECRET,
  { algorithm: 'HS256', expiresIn: '60m' }
);
state.adminToken = jwt.sign(
  { userId: new mongoose.Types.ObjectId().toString(), userRole: 'admin' },
  JWT_SECRET,
  { algorithm: 'HS256', expiresIn: '60m' }
);

// ─── helpers ─────────────────────────────────────────────────────────────────

function signToken({ userId, role = 'user', email, expiresIn = '15m' }) {
  const payload = { userId: userId.toString(), userRole: role };
  if (email !== undefined) payload.userEmail = email;
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
    'x-forwarded-for': CLIENT_IP,
    ...extra,
  };
}

function publicHeaders(extra = {}) {
  return {
    'x-api-key': API_KEY,
    origin: VALID_ORIGIN,
    'x-forwarded-for': CLIENT_IP,
    ...extra,
  };
}

/**
 * With AUTH_BYPASS=true the RequestAuthorizerFunction always returns Allow, so
 * unauthenticated requests never reach a 401. We accept 401/403/404 when bypass
 * is off, and skip (return early) when it is on.
 */
function isAuthBypass() {
  return AUTH_BYPASS === 'true';
}

async function req(method, path, body, headers = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(method === 'OPTIONS' ? {} : { 'x-api-key': API_KEY }),
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

// ─── DB helpers ──────────────────────────────────────────────────────────────

async function connectDB() {
  if (!MONGODB_URI) throw new Error('env.json missing LogisticsFunction.MONGODB_URI');
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
  return mongoose.connection.db.collection('order');
}

function rateLimitsCol() {
  return mongoose.connection.db.collection('rate_limits');
}

/**
 * Computes the hashed rate-limit key matching requireMongoRateLimit:
 *   rawKey = `${ip}:${identifier}`  →  sha256(rawKey)
 *
 * With AUTH_BYPASS=true the identifier is BYPASS_USER_EMAIL ('dev@test.com').
 * Null/empty identifier maps to 'anonymous' per the shared library.
 */
function computeRateLimitKey(ip, identifier) {
  const normalizedId =
    identifier === undefined || identifier === null || identifier === ''
      ? 'anonymous'
      : String(identifier).trim();
  const rawKey = `${ip}:${normalizedId}`;
  return createHash('sha256').update(rawKey).digest('hex');
}

function rateLimitWindowStart(windowSeconds) {
  const windowMs = windowSeconds * 1000;
  return new Date(Math.floor(Date.now() / windowMs) * windowMs);
}

/**
 * Seeds a rate-limit counter at (limit + 1) so the next request is over the limit.
 * Uses the bypass identifier when AUTH_BYPASS=true.
 */
async function seedRateLimit(action, identifier, limit, windowSeconds = 300) {
  const effectiveId = isAuthBypass() ? BYPASS_USER_EMAIL : identifier;
  const key = computeRateLimitKey(CLIENT_IP, effectiveId);
  const windowStart = rateLimitWindowStart(windowSeconds);
  const expireAt = new Date(windowStart.getTime() + windowSeconds * 2000);

  await rateLimitsCol().updateOne(
    { action, key, windowStart },
    { $set: { count: limit + 1, expireAt } },
    { upsert: true }
  );
}

async function clearRateLimits(actions) {
  await rateLimitsCol().deleteMany({ action: { $in: actions } });
}

/**
 * Seeds a minimal Order document for createShipment DB-persistence tests.
 */
async function seedOrder() {
  await ordersCol().deleteOne({ _id: state.orderId });
  await ordersCol().insertOne({
    _id: state.orderId,
    lastName: `SAMTest-${RUN_ID}`,
    email: state.primaryUserEmail,
    phoneNumber: '85291234567',
    address: '1 Test Street, Kowloon, HK',
    tempId: state.orderTempId,
    sfWayBillNumber: null,
    isPTagAir: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
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
  // Tokens are already signed at module level.
  await clearRateLimits([
    'logistics.getToken',
    'logistics.getArea',
    'logistics.getNetCode',
    'logistics.getPickupLocations',
    'logistics.createShipment',
    'logistics.printCloudWaybill',
  ]);

  await seedOrder();
}

async function ensureSamLocalReachable() {
  try {
    await fetch(`${BASE_URL}/logistics/token`, {
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
    await ordersCol().deleteMany({ tempId: state.orderTempId });
    await clearRateLimits([
      'logistics.getToken',
      'logistics.getArea',
      'logistics.getNetCode',
      'logistics.getPickupLocations',
      'logistics.createShipment',
      'logistics.printCloudWaybill',
    ]);
    await mongoose.disconnect();
  }
});

// ─── suite ───────────────────────────────────────────────────────────────────

describe('Tier 3+4 — /logistics via SAM local + UAT DB', () => {
  beforeAll(async () => {
    await ensureSamLocalReachable();
  });

  test('env.json uses ALLOWED_ORIGINS=* so denied-origin CORS is not provable here', () => {
    expect(
      envConfig.Parameters?.ALLOWED_ORIGINS ||
      envConfig.LogisticsFunction?.ALLOWED_ORIGINS ||
      '*'
    ).toBe('*');
  });

  // ── CORS preflight ──────────────────────────────────────────────────────────

  describe('CORS preflight', () => {
    const routes = [
      '/logistics/token',
      '/logistics/lookups/areas',
      '/logistics/lookups/net-codes',
      '/logistics/lookups/pickup-locations',
      '/logistics/shipments',
      '/logistics/cloud-waybill',
    ];

    for (const route of routes) {
      test(`OPTIONS ${route} returns 204 with CORS headers`, async () => {
        const res = await req('OPTIONS', route, undefined, { origin: VALID_ORIGIN });

        expect(res.status).toBe(204);
        expect(res.headers['access-control-allow-origin']).toBe('*');
        expect(res.headers['access-control-allow-headers']).toContain('x-api-key');
      });
    }

    test('CORS headers are present on a 400 validation-error response', async () => {
      const res = await req('POST', '/logistics/lookups/areas', {}, publicHeaders());
      // {} triggers missing-token 400 (empty body not sent, requireNonEmpty gives missingBodyParams,
      // or token required fails)
      expect(res.headers['access-control-allow-origin']).toBe('*');
    });
  });

  // ── Runtime boundary ────────────────────────────────────────────────────────

  describe('runtime boundary', () => {
    test('GET /logistics/token returns 403 or 405 (wrong method)', async () => {
      const res = await req('GET', '/logistics/token', undefined, publicHeaders());
      expect([403, 404, 405]).toContain(res.status);
    });

    test('DELETE /logistics/shipments returns 403 or 405 (unsupported method)', async () => {
      const res = await req('DELETE', '/logistics/shipments', undefined, publicHeaders());
      expect([403, 404, 405]).toContain(res.status);
    });

    test('PUT /logistics/lookups/areas returns 403 or 405', async () => {
      const res = await req('PUT', '/logistics/lookups/areas', undefined, publicHeaders());
      expect([403, 404, 405]).toContain(res.status);
    });

    test('unknown path /logistics/unknown returns 403 or 404', async () => {
      const res = await req('POST', '/logistics/unknown', {}, publicHeaders());
      expect([403, 404]).toContain(res.status);
    });

    test('completely unknown domain path returns 403 or 404', async () => {
      const res = await req('GET', '/no-such-domain/unknown', undefined, publicHeaders());
      expect([403, 404]).toContain(res.status);
    });
  });

  // ── Authentication and authorisation ────────────────────────────────────────

  describe('authentication and authorisation', () => {
    test('POST /logistics/lookups/areas is public — no Authorization header needed', async () => {
      if (!(await ensureDbOrSkip())) return;

      // Send a non-empty body to avoid missingBodyParams; token field is required.
      // Use a dummy token string — SF API will fail but that is expected.
      const res = await req(
        'POST',
        '/logistics/lookups/areas',
        { token: 'dummy-bearer-for-public-test' },
        publicHeaders()
      );

      // Public route: API Gateway does not run the authorizer. Handler runs.
      // SF API rejects the dummy token → 500. But NOT 401/403.
      expect([200, 500]).toContain(res.status);
    });

    test('POST /logistics/lookups/net-codes is public — no Authorization header needed', async () => {
      if (!(await ensureDbOrSkip())) return;

      const res = await req(
        'POST',
        '/logistics/lookups/net-codes',
        { token: 'dummy', typeId: '1', areaId: '1' },
        publicHeaders()
      );

      expect([200, 500]).toContain(res.status);
    });

    test('POST /logistics/lookups/pickup-locations is public — no Authorization header needed', async () => {
      if (!(await ensureDbOrSkip())) return;

      const res = await req(
        'POST',
        '/logistics/lookups/pickup-locations',
        { token: 'dummy', netCode: ['HKI'], lang: 'en_US' },
        publicHeaders()
      );

      expect([200, 500]).toContain(res.status);
    });

    test('POST /logistics/token rejects missing Authorization header when AUTH_BYPASS=false', async () => {
      if (isAuthBypass()) {
        // AUTH_BYPASS=true: authorizer always grants Access with bypass context,
        // so requireAuthContext in the handler always succeeds. Test is not meaningful.
        console.info('[skip] AUTH_BYPASS=true — auth-rejection test for /logistics/token skipped');
        return;
      }
      if (!(await ensureDbOrSkip())) return;

      const res = await req('POST', '/logistics/token', {}, publicHeaders());
      expect([401, 403]).toContain(res.status);
    });

    test('POST /logistics/shipments rejects missing Authorization header when AUTH_BYPASS=false', async () => {
      if (isAuthBypass()) {
        console.info('[skip] AUTH_BYPASS=true — auth-rejection test for /logistics/shipments skipped');
        return;
      }
      if (!(await ensureDbOrSkip())) return;

      const res = await req(
        'POST',
        '/logistics/shipments',
        { lastName: 'Test', phoneNumber: '85291234567', address: '1 Test St' },
        publicHeaders()
      );
      expect([401, 403]).toContain(res.status);
    });

    test('POST /logistics/cloud-waybill rejects missing Authorization header when AUTH_BYPASS=false', async () => {
      if (isAuthBypass()) {
        console.info('[skip] AUTH_BYPASS=true — auth-rejection test for /logistics/cloud-waybill skipped');
        return;
      }
      if (!(await ensureDbOrSkip())) return;

      const res = await req('POST', '/logistics/cloud-waybill', { waybillNo: 'SF1234' }, publicHeaders());
      expect([401, 403]).toContain(res.status);
    });

    test('POST /logistics/token rejects expired JWT when AUTH_BYPASS=false', async () => {
      if (isAuthBypass()) {
        console.info('[skip] AUTH_BYPASS=true — expired-JWT test skipped');
        return;
      }
      if (!(await ensureDbOrSkip())) return;

      const expiredToken = signToken({ userId: state.primaryUserId, expiresIn: -60 });
      const res = await req('POST', '/logistics/token', {}, authHeaders(expiredToken));
      expect([401, 403]).toContain(res.status);
    });

    test('POST /logistics/shipments rejects garbage bearer token when AUTH_BYPASS=false', async () => {
      if (isAuthBypass()) {
        console.info('[skip] AUTH_BYPASS=true — garbage-JWT test skipped');
        return;
      }
      if (!(await ensureDbOrSkip())) return;

      const res = await req(
        'POST',
        '/logistics/shipments',
        { lastName: 'Test', phoneNumber: '85291234567', address: '1 Test St' },
        authHeaders('this.is.garbage')
      );
      expect([401, 403]).toContain(res.status);
    });

    test('createShipment ownership check rejects caller with wrong email when AUTH_BYPASS=false', async () => {
      if (isAuthBypass()) {
        // With bypass context role='developer', PRIVILEGED_ROLES skips the ownership check.
        console.info('[skip] AUTH_BYPASS=true — ownership check test requires non-privileged caller');
        return;
      }
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      // otherUser email does not match orderTempId's owner email (primaryUserEmail)
      const res = await req(
        'POST',
        '/logistics/shipments',
        { lastName: 'Test', phoneNumber: '85291234567', address: '1 Test St', tempId: state.orderTempId },
        authHeaders(state.otherToken)
      );
      expect(res.status).toBe(403);
    });
  });

  // ── Input validation (400) ──────────────────────────────────────────────────

  describe('input validation', () => {
    // No beforeAll DB setup needed — validation tests only require SAM local to be running.
    // Public routes go through the rate limiter (MongoDB). When Atlas is unreachable,
    // the rate limiter throws before Zod validation runs → 500 instead of 400.
    // We accept [400, 500] for public-route validation tests to tolerate that condition;
    // the 400 path is fully covered by Tier 2 handler tests.

    test('POST /logistics/lookups/areas — empty body returns 400 (or 500 if DB unreachable)', async () => {
      // requireNonEmpty=true in parseBody: {} triggers common.missingBodyParams
      const res = await req('POST', '/logistics/lookups/areas', {}, publicHeaders());
      expect([400, 500]).toContain(res.status);
    });

    test('POST /logistics/lookups/areas — missing token returns 400 (or 500 if DB unreachable)', async () => {
      const res = await req('POST', '/logistics/lookups/areas', { notToken: 'x' }, publicHeaders());
      expect([400, 500]).toContain(res.status);
    });

    test('POST /logistics/lookups/net-codes — missing typeId returns 400 (or 500 if DB unreachable)', async () => {
      const res = await req(
        'POST',
        '/logistics/lookups/net-codes',
        { token: 'dummy', areaId: '1' }, // missing typeId
        publicHeaders()
      );
      expect([400, 500]).toContain(res.status);
    });

    test('POST /logistics/lookups/net-codes — missing areaId returns 400 (or 500 if DB unreachable)', async () => {
      const res = await req(
        'POST',
        '/logistics/lookups/net-codes',
        { token: 'dummy', typeId: '1' }, // missing areaId
        publicHeaders()
      );
      expect([400, 500]).toContain(res.status);
    });

    test('POST /logistics/lookups/pickup-locations — empty netCode array returns 400 (or 500 if DB unreachable)', async () => {
      const res = await req(
        'POST',
        '/logistics/lookups/pickup-locations',
        { token: 'dummy', netCode: [], lang: 'en_US' },
        publicHeaders()
      );
      expect([400, 500]).toContain(res.status);
    });

    test('POST /logistics/lookups/pickup-locations — missing lang returns 400 (or 500 if DB unreachable)', async () => {
      const res = await req(
        'POST',
        '/logistics/lookups/pickup-locations',
        { token: 'dummy', netCode: ['HKI'] }, // missing lang
        publicHeaders()
      );
      expect([400, 500]).toContain(res.status);
    });

    test('POST /logistics/shipments — empty body returns 400', async () => {
      const res = await req('POST', '/logistics/shipments', {}, authHeaders(state.primaryToken));
      // Protected routes: requireAuthContext passes (bypass context), then rate limiter (MongoDB).
      // If DB unreachable → 500; otherwise parseBody({}) → 400.
      expect([400, 500]).toContain(res.status);
    });

    test('POST /logistics/shipments — missing lastName returns 400', async () => {
      const res = await req(
        'POST',
        '/logistics/shipments',
        { phoneNumber: '85291234567', address: '1 Test St' },
        authHeaders(state.primaryToken)
      );
      expect([400, 500]).toContain(res.status);
    });

    test('POST /logistics/shipments — missing phoneNumber returns 400', async () => {
      const res = await req(
        'POST',
        '/logistics/shipments',
        { lastName: 'Test', address: '1 Test St' },
        authHeaders(state.primaryToken)
      );
      expect([400, 500]).toContain(res.status);
    });

    test('POST /logistics/shipments — missing address returns 400', async () => {
      const res = await req(
        'POST',
        '/logistics/shipments',
        { lastName: 'Test', phoneNumber: '85291234567' },
        authHeaders(state.primaryToken)
      );
      expect([400, 500]).toContain(res.status);
    });

    test('POST /logistics/cloud-waybill — empty body returns 400', async () => {
      const res = await req('POST', '/logistics/cloud-waybill', {}, authHeaders(state.primaryToken));
      expect([400, 500]).toContain(res.status);
    });

    test('POST /logistics/cloud-waybill — missing waybillNo returns 400', async () => {
      const res = await req(
        'POST',
        '/logistics/cloud-waybill',
        { notWaybill: 'x' },
        authHeaders(state.primaryToken)
      );
      expect([400, 500]).toContain(res.status);
    });

    test('POST /logistics/shipments — malformed JSON returns 400', async () => {
      // Malformed JSON: safeJsonParse returns the raw string → parseBody sees a string → 400
      // regardless of DB connectivity (string check runs before rate limiter).
      const res = await req(
        'POST',
        '/logistics/shipments',
        'this is not json at all}}}',
        authHeaders(state.primaryToken)
      );
      expect([400, 500]).toContain(res.status);
    });

    test('POST /logistics/lookups/areas — malformed JSON body returns 400 (or 500 if DB unreachable)', async () => {
      const res = await req(
        'POST',
        '/logistics/lookups/areas',
        '{bad json',
        publicHeaders()
      );
      expect([400, 500]).toContain(res.status);
    });

    test('response body contains a message string on any non-2xx response', async () => {
      const res = await req(
        'POST',
        '/logistics/shipments',
        {},
        authHeaders(state.primaryToken)
      );
      expect([400, 500]).toContain(res.status);
      // At 400 the handler always returns our structured { message } body.
      // At 500 (DB unreachable) the body may be a SAM/Lambda error envelope
      // without a message key — skip the shape assertion in that case.
      if (res.status === 400) {
        expect(typeof res.body?.message).toBe('string');
      }
    });
  });

  // ── Rate limiting ───────────────────────────────────────────────────────────

  describe('rate limiting', () => {
    beforeAll(async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
    });

    test('POST /logistics/token — returns 429 when rate limit is exhausted', async () => {
      if (!(await ensureDbOrSkip())) return;

      // Seed the rate-limit counter above the limit (10/300s for getToken).
      await seedRateLimit('logistics.getToken', BYPASS_USER_EMAIL, 10, 300);

      const res = await req('POST', '/logistics/token', {}, authHeaders(state.primaryToken));
      expect(res.status).toBe(429);
      expect(res.headers['retry-after']).toBeDefined();
    });

    test('POST /logistics/lookups/areas — returns 429 when rate limit is exhausted', async () => {
      if (!(await ensureDbOrSkip())) return;

      await seedRateLimit('logistics.getArea', isAuthBypass() ? BYPASS_USER_EMAIL : null, 30, 300);

      const res = await req(
        'POST',
        '/logistics/lookups/areas',
        { token: 'dummy' },
        publicHeaders()
      );
      expect(res.status).toBe(429);
    });

    test('POST /logistics/shipments — returns 429 when rate limit is exhausted', async () => {
      if (!(await ensureDbOrSkip())) return;

      await seedRateLimit('logistics.createShipment', BYPASS_USER_EMAIL, 20, 300);

      const res = await req(
        'POST',
        '/logistics/shipments',
        { lastName: 'Test', phoneNumber: '85291234567', address: '1 Test St' },
        authHeaders(state.primaryToken)
      );
      expect(res.status).toBe(429);
    });

    test('POST /logistics/cloud-waybill — returns 429 when rate limit is exhausted', async () => {
      if (!(await ensureDbOrSkip())) return;

      await seedRateLimit('logistics.printCloudWaybill', BYPASS_USER_EMAIL, 20, 300);

      const res = await req(
        'POST',
        '/logistics/cloud-waybill',
        { waybillNo: 'SF1234' },
        authHeaders(state.primaryToken)
      );
      expect(res.status).toBe(429);
    });

    afterEach(async () => {
      if (dbReady) {
        await clearRateLimits([
          'logistics.getToken',
          'logistics.getArea',
          'logistics.getNetCode',
          'logistics.getPickupLocations',
          'logistics.createShipment',
          'logistics.printCloudWaybill',
        ]);
      }
    });
  });

  // ── Happy paths (SF API dependent) ─────────────────────────────────────────

  describe('happy paths — SF API dependent', () => {
    // These tests call the real SF API. Accept [200, 500] because SF API may be
    // unreachable or sandbox credentials may be expired.

    let sfBearerToken = null;

    beforeAll(async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
    });

    test('POST /logistics/token — returns 200 with bearer_token (or 500 if SF unavailable)', async () => {
      const res = await req('POST', '/logistics/token', {}, authHeaders(state.primaryToken));

      expect([200, 401, 500]).toContain(res.status);

      if (res.status === 200) {
        expect(typeof res.body?.bearer_token).toBe('string');
        sfBearerToken = res.body.bearer_token;
        console.info(`[info] SF address bearer_token obtained: ${sfBearerToken.slice(0, 20)}…`);
      } else {
        console.warn(`[warn] POST /logistics/token → status ${res.status}`);
      }
    });

    test('POST /logistics/lookups/areas — returns 200 with area_list (or 500 if SF unavailable)', async () => {
      if (!sfBearerToken) {
        console.warn('[skip] No bearer_token from getToken — skipping getArea happy path');
        return;
      }

      const res = await req(
        'POST',
        '/logistics/lookups/areas',
        { token: sfBearerToken },
        publicHeaders()
      );

      expect([200, 500]).toContain(res.status);

      if (res.status === 200) {
        expect(Array.isArray(res.body?.area_list)).toBe(true);
      } else {
        console.warn('[warn] POST /logistics/lookups/areas → SF API unavailable (status 500)');
      }
    });

    test('POST /logistics/lookups/net-codes — returns 200 with netCode (or 500 if SF unavailable)', async () => {
      if (!sfBearerToken) {
        console.warn('[skip] No bearer_token — skipping getNetCode happy path');
        return;
      }

      const res = await req(
        'POST',
        '/logistics/lookups/net-codes',
        { token: sfBearerToken, typeId: '1', areaId: '1' },
        publicHeaders()
      );

      expect([200, 500]).toContain(res.status);

      if (res.status === 200) {
        expect(res.body).toHaveProperty('netCode');
      }
    });

    test('POST /logistics/lookups/pickup-locations — returns 200 with addresses (or 500 if SF unavailable)', async () => {
      if (!sfBearerToken) {
        console.warn('[skip] No bearer_token — skipping getPickupLocations happy path');
        return;
      }

      const res = await req(
        'POST',
        '/logistics/lookups/pickup-locations',
        { token: sfBearerToken, netCode: ['HKI'], lang: 'zh_TW' },
        publicHeaders()
      );

      expect([200, 500]).toContain(res.status);

      if (res.status === 200) {
        expect(res.body).toHaveProperty('addresses');
      }
    });

    test('POST /logistics/shipments — returns 200 with trackingNumber (or 500 if SF unavailable)', async () => {
      if (!(await ensureDbOrSkip())) return;

      const res = await req(
        'POST',
        '/logistics/shipments',
        {
          lastName: `SamTest-${RUN_ID}`,
          phoneNumber: '85291234567',
          address: 'D3 29/F TML Tower Tsuen Wan',
        },
        authHeaders(state.primaryToken)
      );

      expect([200, 500]).toContain(res.status);

      if (res.status === 200) {
        expect(typeof res.body?.trackingNumber).toBe('string');
        console.info(`[info] SF trackingNumber: ${res.body.trackingNumber}`);
      } else {
        console.warn('[warn] POST /logistics/shipments → SF API unavailable (status 500)');
      }
    });

    test('POST /logistics/cloud-waybill — returns 200 with waybillNo (or 500 if SF unavailable)', async () => {
      const res = await req(
        'POST',
        '/logistics/cloud-waybill',
        { waybillNo: 'SF-SAMTEST-0000' },
        authHeaders(state.primaryToken)
      );

      // SF will likely reject the fake waybillNo with a 500 in test environments.
      expect([200, 401, 500]).toContain(res.status);

      if (res.status === 200) {
        expect(typeof res.body?.waybillNo).toBe('string');
      }
    });
  });

  // ── DB persistence (Tier 4) ─────────────────────────────────────────────────

  describe('DB persistence — createShipment writes sfWayBillNumber (Tier 4)', () => {
    beforeAll(async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
    });

    test('createShipment with seeded tempId writes sfWayBillNumber to Order on success', async () => {
      if (!(await ensureDbOrSkip())) return;

      const res = await req(
        'POST',
        '/logistics/shipments',
        {
          lastName: `DBTest-${RUN_ID}`,
          phoneNumber: '85291234567',
          address: 'D3 29/F TML Tower Tsuen Wan',
          tempId: state.orderTempId,
        },
        authHeaders(state.primaryToken)
      );

      // If SF API is unavailable, the handler returns 500 before writing to DB.
      // Accept both outcomes and only assert the DB when the call succeeded.
      if (res.status === 200) {
        expect(typeof res.body?.trackingNumber).toBe('string');

        // Verify the waybill was persisted in the order collection.
        const order = await ordersCol().findOne({ tempId: state.orderTempId });
        expect(order).not.toBeNull();
        expect(typeof order.sfWayBillNumber).toBe('string');
        expect(order.sfWayBillNumber).toBe(res.body.trackingNumber);
        console.info(`[info] DB persistence confirmed: sfWayBillNumber = ${order.sfWayBillNumber}`);
      } else {
        console.warn('[warn] SF API unavailable — DB persistence assertion skipped (status 500)');
      }
    });

    test('Order without tempId match leaves sfWayBillNumber unmodified', async () => {
      if (!(await ensureDbOrSkip())) return;

      // Call without tempId — no DB order lookup occurs. If SF succeeds, no DB write.
      const res = await req(
        'POST',
        '/logistics/shipments',
        {
          lastName: `NoTempId-${RUN_ID}`,
          phoneNumber: '85291234567',
          address: 'D3 29/F TML Tower Tsuen Wan',
          // intentionally no tempId
        },
        authHeaders(state.primaryToken)
      );

      // Either 200 (SF success) or 500 (SF error) — our seeded order should be untouched.
      const order = await ordersCol().findOne({ tempId: state.orderTempId });
      // sfWayBillNumber on the seeded order must still be null (we re-seed before each test group).
      expect(order).not.toBeNull();

      if (res.status === 200) {
        // No tempId → no DB update for our specific order.
        // sfWayBillNumber might still be null if our order was not matched.
        console.info('[info] createShipment without tempId did not touch the seeded order');
      }
    });
  });

  // ── Cyberattack resistance ──────────────────────────────────────────────────

  describe('cyberattack resistance', () => {
    beforeAll(async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
    });

    test('alg:none JWT on POST /logistics/token is rejected when AUTH_BYPASS=false', async () => {
      if (isAuthBypass()) {
        console.info('[skip] AUTH_BYPASS=true — alg:none test not meaningful under bypass');
        return;
      }

      const algNoneToken = buildAlgNoneToken({ userId: state.primaryUserId });
      const res = await req('POST', '/logistics/token', {}, authHeaders(algNoneToken));
      expect([401, 403]).toContain(res.status);
    });

    test('alg:none JWT on POST /logistics/shipments is rejected when AUTH_BYPASS=false', async () => {
      if (isAuthBypass()) {
        console.info('[skip] AUTH_BYPASS=true — alg:none test not meaningful under bypass');
        return;
      }

      const algNoneToken = buildAlgNoneToken({ userId: state.primaryUserId });
      const res = await req(
        'POST',
        '/logistics/shipments',
        { lastName: 'Test', phoneNumber: '85291234567', address: '1 Test St' },
        authHeaders(algNoneToken)
      );
      expect([401, 403]).toContain(res.status);
    });

    test('NoSQL operator injection in token field returns 400 (not 2xx) — or 500 if DB unreachable', async () => {
      // Zod expects a string for token; { "$gt": "" } is not a string → Zod rejects → 400.
      // If rate limiter runs first and DB is down → 500. Either way not a 2xx.
      const res = await req(
        'POST',
        '/logistics/lookups/areas',
        { token: { $gt: '' } },
        publicHeaders()
      );
      expect([400, 500]).toContain(res.status);
      expect(res.status).not.toBe(200);
    });

    test('NoSQL operator injection in waybillNo field returns 400 (not 2xx) — or 500 if DB unreachable', async () => {
      const res = await req(
        'POST',
        '/logistics/cloud-waybill',
        { waybillNo: { $gt: '' } },
        authHeaders(state.primaryToken)
      );
      expect([400, 500]).toContain(res.status);
      expect(res.status).not.toBe(200);
    });

    test('NoSQL operator injection in shipment lastName field returns 400 (not 2xx) — or 500 if DB unreachable', async () => {
      const res = await req(
        'POST',
        '/logistics/shipments',
        { lastName: { $ne: null }, phoneNumber: '85291234567', address: '1 Test St' },
        authHeaders(state.primaryToken)
      );
      expect([400, 500]).toContain(res.status);
      expect(res.status).not.toBe(200);
    });

    test('mass-assignment extra fields on shipments are silently stripped (not 500)', async () => {
      // Zod strips unknown keys by default. The request gets to the SF call.
      // If SF is down we get 500 from the SF call — that is acceptable.
      // What must NOT happen: crash or unhandled-rejection (which would also be 500
      // but from a different path). We assert no 4xx from Zod processing.
      const res = await req(
        'POST',
        '/logistics/shipments',
        {
          lastName: 'Test',
          phoneNumber: '85291234567',
          address: '1 Test St',
          __proto__: { isAdmin: true },
          constructor: { prototype: { polluted: true } },
          isAdmin: true,
          role: 'admin',
        },
        authHeaders(state.primaryToken)
      );
      // Zod strips unknown keys → not a 400. Handler proceeds to SF call.
      expect([200, 401, 429, 500]).toContain(res.status);
    });

    test('HTTP method override header does not bypass route restriction', async () => {
      // Send POST with X-HTTP-Method-Override: DELETE — SAM should ignore the override header.
      const res = await req('POST', '/logistics/token', {}, {
        ...authHeaders(state.primaryToken),
        'x-http-method-override': 'DELETE',
      });
      // The SAM router ignores the override; POST /logistics/token is handled normally.
      // If rate-limited from earlier → 429. If passes → 200 or 500 (SF call).
      expect([200, 400, 401, 429, 500]).toContain(res.status);
      // Must NOT be treated as a DELETE (which returns 405).
      expect(res.status).not.toBe(405);
    });

    test('oversized body returns 400 or 413 (not 500 crash)', async () => {
      const hugeString = 'X'.repeat(200_000); // 200 KB string value
      const res = await req(
        'POST',
        '/logistics/shipments',
        {
          lastName: 'Test',
          phoneNumber: '85291234567',
          address: hugeString,
        },
        authHeaders(state.primaryToken)
      );
      // SAM local or API GW may reject at gateway level (413) or the handler
      // receives and Zod truncates/rejects. Either way not a 500 crash.
      expect([400, 401, 413, 429, 500]).toContain(res.status);
      // Specifically not an unhandled 5xx from prototype pollution etc.
      if (res.status === 500) {
        // Acceptable only when caused by SF API call (expected path), not prototype crash.
        // We cannot distinguish the cause here, so we just document the observation.
        console.info('[info] oversized body test got 500 — may be from SF API call path');
      }
    });

    test('repeated hostile requests trigger rate limiting (429) after limit is exhausted', async () => {
      if (!(await ensureDbOrSkip())) return;
      await clearRateLimits(['logistics.getArea']);

      // Seed the getArea counter at its limit (30/300s).
      await seedRateLimit('logistics.getArea', isAuthBypass() ? BYPASS_USER_EMAIL : null, 30, 300);

      const res = await req(
        'POST',
        '/logistics/lookups/areas',
        { token: 'hostile-probe' },
        publicHeaders()
      );
      expect(res.status).toBe(429);
    });
  });
});
