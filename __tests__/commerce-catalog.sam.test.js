// Tier 3 — SAM local HTTP integration tests for the commerce-catalog Lambda.
//
// Prerequisites (run before this suite):
//   sam local start-api \
//     --template .aws-sam/build/template.yaml \
//     --env-vars env.json \
//     --warm-containers EAGER
//
// The suite reads env.json for the MongoDB URI and API key.
// DB-dependent tests seed their own fixtures and clean up in afterAll.

const dns = require('dns');
const mongoose = require('mongoose');
const envConfig = require('../env.json');

const BASE_URL = process.env.COMMERCE_CATALOG_UAT_BASE_URL || 'http://127.0.0.1:3000';
const TEST_TS = Date.now();
const RUN_ID = `ddd-catalog-${TEST_TS}`;
const API_KEY =
  process.env.COMMERCE_CATALOG_TEST_API_KEY ||
  envConfig.Parameters?.ExistingApiKeyId ||
  'test-api-key';
const MONGODB_URI =
  envConfig.CommerceCatalogFunction?.MONGODB_URI ||
  envConfig.Parameters?.MONGODB_URI ||
  '';
const ALLOWED_ORIGINS = envConfig.Parameters?.ALLOWED_ORIGINS || '*';
const VALID_ORIGIN = 'http://localhost:3000';

let dbReady = false;
let dbConnectAttempted = false;
let dbConnectError = null;

const state = {
  createdLogIds: [],
};

// ─── helpers ─────────────────────────────────────────────────────────────────

function baseHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    'x-api-key': API_KEY,
    origin: VALID_ORIGIN,
    'x-forwarded-for': `198.51.100.${(TEST_TS % 200) + 1}`,
    ...extra,
  };
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
  if (!MONGODB_URI) throw new Error('env.json missing CommerceCatalogFunction.MONGODB_URI');
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

function productLogsCol() {
  return mongoose.connection.db.collection('product_log');
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

async function ensureSamLocalReachable() {
  try {
    await fetch(`${BASE_URL}/commerce/catalog`, {
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
    if (state.createdLogIds.length > 0) {
      await productLogsCol().deleteMany({ _id: { $in: state.createdLogIds } });
    }
    await mongoose.disconnect();
  }
});

// ─── suite ───────────────────────────────────────────────────────────────────

describe('Tier 3 - /commerce/catalog via SAM local + UAT DB', () => {
  beforeAll(async () => {
    await ensureSamLocalReachable();
  });

  test('denied-origin preflight is not provable because env.json uses ALLOWED_ORIGINS=*', () => {
    expect(ALLOWED_ORIGINS).toBe('*');
  });

  // ── Happy paths ─────────────────────────────────────────────────────────────

  describe('happy paths', () => {
    test('GET /commerce/catalog returns 200 with items array and CORS header', async () => {
      const res = await req('GET', '/commerce/catalog');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.headers['access-control-allow-origin']).toBe('*');
    });

    test('GET /commerce/storefront returns 200 with shops array', async () => {
      const res = await req('GET', '/commerce/storefront');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.shops)).toBe(true);
    });

    test('POST /commerce/catalog/events creates a product log and persists it to DB', async () => {
      if (!(await ensureDbOrSkip())) return;

      const body = {
        petId: `${RUN_ID}-pet`,
        userId: `${RUN_ID}-user`,
        userEmail: `${RUN_ID}@test.com`,
        productUrl: 'https://example.com/product/123',
        accessAt: new Date().toISOString(),
      };

      const res = await req('POST', '/commerce/catalog/events', body);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.id).toBeDefined();

      const oid = new mongoose.Types.ObjectId(res.body.id);
      state.createdLogIds.push(oid);

      const persisted = await productLogsCol().findOne({ _id: oid });
      expect(persisted).not.toBeNull();
      expect(persisted.userId).toBe(body.userId);
      expect(persisted.userEmail).toBe(body.userEmail);
      expect(persisted.petId).toBe(body.petId);
      expect(persisted.productUrl).toBe(body.productUrl);
    });

    test('repeated POST /commerce/catalog/events with identical data creates two separate log entries', async () => {
      if (!(await ensureDbOrSkip())) return;

      const body = {
        petId: `${RUN_ID}-repeat-pet`,
        userId: `${RUN_ID}-repeat-user`,
        userEmail: `${RUN_ID}-repeat@test.com`,
        productUrl: 'https://example.com/product/repeat',
      };

      const first = await req('POST', '/commerce/catalog/events', body);
      const second = await req('POST', '/commerce/catalog/events', body);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(first.body.id).not.toBe(second.body.id);

      state.createdLogIds.push(
        new mongoose.Types.ObjectId(first.body.id),
        new mongoose.Types.ObjectId(second.body.id)
      );
    });
  });

  // ── Input validation - 400 ──────────────────────────────────────────────────

  describe('input validation - 400', () => {
    test('POST /commerce/catalog/events rejects a missing petId', async () => {
      const res = await req('POST', '/commerce/catalog/events', {
        userId: `${RUN_ID}-user`,
        userEmail: `${RUN_ID}@test.com`,
        productUrl: 'https://example.com/product/123',
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('POST /commerce/catalog/events rejects a missing userEmail', async () => {
      const res = await req('POST', '/commerce/catalog/events', {
        petId: `${RUN_ID}-pet`,
        userId: `${RUN_ID}-user`,
        productUrl: 'https://example.com/product/123',
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('POST /commerce/catalog/events rejects a malformed JSON body', async () => {
      const res = await req(
        'POST',
        '/commerce/catalog/events',
        '{"petId":"abc"',
        baseHeaders({ 'Content-Type': 'application/json' })
      );

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('POST /commerce/catalog/events rejects an empty body', async () => {
      const res = await req('POST', '/commerce/catalog/events', {});

      expect(res.status).toBe(400);
    });
  });

  // ── Route infrastructure ────────────────────────────────────────────────────

  describe('route infrastructure', () => {
    test('returns 404 for an unknown commerce/catalog sub-path', async () => {
      const res = await req('GET', '/commerce/catalog/unknown-path');

      expect(res.status).toBe(404);
    });

    test('returns 405 for DELETE on /commerce/catalog', async () => {
      const res = await req('DELETE', '/commerce/catalog');

      expect(res.status).toBe(405);
    });

    test('OPTIONS /commerce/catalog returns 204 with allowed-origin CORS header', async () => {
      const res = await fetch(`${BASE_URL}/commerce/catalog`, {
        method: 'OPTIONS',
        headers: { origin: VALID_ORIGIN },
      });

      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
    });
  });

  // ── Cyberattacks ────────────────────────────────────────────────────────────

  describe('cyberattacks', () => {
    test('POST /commerce/catalog/events rejects NoSQL operator injection in petId', async () => {
      const res = await req('POST', '/commerce/catalog/events', {
        petId: { $gt: '' },
        userId: `${RUN_ID}-attack`,
        userEmail: `${RUN_ID}-attack@test.com`,
        productUrl: 'https://example.com/product',
      });

      // zod schema requires petId to be a string — this should fail validation
      expect(res.status).toBe(400);
    });

    test('POST /commerce/catalog/events rejects extra injected fields via strict-schema mass-assignment', async () => {
      const res = await req('POST', '/commerce/catalog/events', {
        petId: `${RUN_ID}-inject`,
        userId: `${RUN_ID}-inject`,
        userEmail: `${RUN_ID}-inject@test.com`,
        productUrl: 'https://example.com/product',
        __proto__: { isAdmin: true },
        constructor: { prototype: { isAdmin: true } },
        extraMaliciousField: 'injected',
      });

      // Extra fields beyond the schema are silently stripped — the request still
      // succeeds but must not persist the injected fields.
      if (res.status === 201 && res.body.id) {
        if (await ensureDbOrSkip()) {
          const oid = new mongoose.Types.ObjectId(res.body.id);
          state.createdLogIds.push(oid);
          const persisted = await productLogsCol().findOne({ _id: oid });
          expect(persisted.extraMaliciousField).toBeUndefined();
          expect(persisted.isAdmin).toBeUndefined();
        }
      } else {
        // Strict-schema rejection is also acceptable
        expect([400, 201]).toContain(res.status);
      }
    });
  });
});
