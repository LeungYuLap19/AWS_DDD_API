// Tier 3 — SAM local HTTP integration tests for the pet-adoption Lambda.
//
// Prerequisites (run before this suite):
//   sam local start-api \
//     --template .aws-sam/build/template.yaml \
//     --env-vars env.json \
//     --warm-containers EAGER
//
// The suite reads env.json for the MongoDB URI, JWT secret, and API key.
// Every DB-dependent test seeds its own fixtures and cleans up in afterAll.
//
// Coverage tiers (per dev_docs/llms/DDD_TESTING_STANDARD.md):
//   Tier 2 mock handler tests:    __tests__/pet-adoption.test.js
//   Tier 3 SAM + Mongo (this):    __tests__/pet-adoption.sam.test.js
//
// Routes under test:
//   GET    /pet/adoption              → public browse list (no auth)
//   GET    /pet/adoption/{id}         → public browse detail (no auth) OR managed GET (with auth)
//   POST   /pet/adoption/{id}         → managed create (protected)
//   PATCH  /pet/adoption/{id}         → managed update (protected)
//   DELETE /pet/adoption/{id}         → managed delete (protected)
//
// DB collections used:
//   pets          — MONGODB_URI (main DB)
//   pet_adoptions — MONGODB_URI (main DB)
//   adoption_list — ADOPTION_MONGODB_URI (separate browse cluster, not seeded here)

const dns = require('dns');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const envConfig = require('../env.json');

const BASE_URL = process.env.PET_ADOPTION_UAT_BASE_URL || 'http://127.0.0.1:3000';
const TEST_TS = Date.now();
const RUN_ID = `ddd-pet-adoption-${TEST_TS}`;
const JWT_SECRET =
  process.env.PET_ADOPTION_TEST_JWT_SECRET ||
  envConfig.RequestAuthorizerFunction?.JWT_SECRET ||
  'PPCSecret';
const API_KEY =
  process.env.PET_ADOPTION_TEST_API_KEY ||
  envConfig.Parameters?.ExistingApiKeyId ||
  'test-api-key';
const MONGODB_URI =
  envConfig.PetAdoptionFunction?.MONGODB_URI || envConfig.Parameters?.MONGODB_URI || '';
const ALLOWED_ORIGINS = envConfig.Parameters?.ALLOWED_ORIGINS || '*';
const AUTH_BYPASS =
  envConfig.Parameters?.AUTH_BYPASS || envConfig.PetAdoptionFunction?.AUTH_BYPASS || 'false';
const VALID_ORIGIN = 'http://localhost:3000';

let dbReady = false;
let dbConnectAttempted = false;
let dbConnectError = null;

const state = {
  primaryUserId: new mongoose.Types.ObjectId(),
  secondaryUserId: new mongoose.Types.ObjectId(),
  ngoUserId: new mongoose.Types.ObjectId(),
  // Pet owned by primary — happy-path managed adoption tests.
  primaryPetId: new mongoose.Types.ObjectId(),
  // Pet owned by secondary — forbidden cross-owner tests.
  secondaryPetId: new mongoose.Types.ObjectId(),
  // Pet owned by primary but soft-deleted.
  deletedPetId: new mongoose.Types.ObjectId(),
  // Pet owned by an NGO.
  ngoPetId: new mongoose.Types.ObjectId(),
  ngoId: `ngo-pet-adoption-${TEST_TS}`,
  primaryToken: null,
  secondaryToken: null,
  ngoToken: null,
};

// ─── helpers ─────────────────────────────────────────────────────────────────

function signToken({ userId, role = 'user', ngoId, expiresIn = '15m' }) {
  const payload = { userId: userId.toString(), userRole: role };
  if (ngoId) payload.ngoId = ngoId.toString();
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

function publicHeaders(extra = {}) {
  return {
    'x-api-key': API_KEY,
    origin: VALID_ORIGIN,
    'x-forwarded-for': `198.51.100.${(TEST_TS % 200) + 1}`,
    ...extra,
  };
}

// With AUTH_BYPASS=true the authorizer may pass through with a bypass identity,
// so the backend can return 401, 403, or 404.
function expectedUnauthenticatedStatuses() {
  return AUTH_BYPASS === 'true' ? [401, 403, 404] : [401, 403];
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

async function connectDB() {
  if (!MONGODB_URI) throw new Error('env.json missing PetAdoptionFunction.MONGODB_URI');
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

function petsCol() {
  return mongoose.connection.db.collection('pets');
}

function adoptionsCol() {
  return mongoose.connection.db.collection('pet_adoptions');
}

async function clearAdoptionFor(petId) {
  await adoptionsCol().deleteMany({ petId: petId.toString() });
}

async function seedFixtures() {
  state.primaryToken = signToken({ userId: state.primaryUserId });
  state.secondaryToken = signToken({ userId: state.secondaryUserId });
  state.ngoToken = signToken({
    userId: state.ngoUserId,
    ngoId: state.ngoId,
    role: 'ngo',
  });

  const nowMs = Date.now();

  await petsCol().deleteMany({
    _id: {
      $in: [
        state.primaryPetId,
        state.secondaryPetId,
        state.deletedPetId,
        state.ngoPetId,
      ],
    },
  });

  await petsCol().insertMany([
    {
      _id: state.primaryPetId,
      userId: state.primaryUserId,
      ngoId: null,
      name: `Mochi-${RUN_ID}`,
      animal: 'Dog',
      sex: 'Female',
      birthday: new Date('2024-01-01T00:00:00.000Z'),
      breedimage: [],
      deleted: false,
      transfer: [],
      transferNGO: [],
      createdAt: new Date(nowMs),
      updatedAt: new Date(nowMs),
    },
    {
      _id: state.secondaryPetId,
      userId: state.secondaryUserId,
      ngoId: null,
      name: `Buddy-${RUN_ID}`,
      animal: 'Cat',
      sex: 'Male',
      birthday: new Date('2023-06-01T00:00:00.000Z'),
      breedimage: [],
      deleted: false,
      transfer: [],
      transferNGO: [],
      createdAt: new Date(nowMs + 1),
      updatedAt: new Date(nowMs + 1),
    },
    {
      _id: state.deletedPetId,
      userId: state.primaryUserId,
      ngoId: null,
      name: `Ghost-${RUN_ID}`,
      animal: 'Dog',
      sex: 'Male',
      birthday: new Date('2022-01-01T00:00:00.000Z'),
      breedimage: [],
      deleted: true,
      transfer: [],
      transferNGO: [],
      createdAt: new Date(nowMs + 2),
      updatedAt: new Date(nowMs + 2),
    },
    {
      _id: state.ngoPetId,
      userId: null,
      ngoId: state.ngoId,
      name: `NGO-Pet-${RUN_ID}`,
      animal: 'Dog',
      sex: 'Female',
      birthday: new Date('2024-06-01T00:00:00.000Z'),
      breedimage: [],
      deleted: false,
      transfer: [],
      transferNGO: [],
      createdAt: new Date(nowMs + 3),
      updatedAt: new Date(nowMs + 3),
    },
  ]);
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
    await fetch(`${BASE_URL}/pet/adoption`, {
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
    await adoptionsCol().deleteMany({
      petId: {
        $in: [
          state.primaryPetId.toString(),
          state.secondaryPetId.toString(),
          state.deletedPetId.toString(),
          state.ngoPetId.toString(),
        ],
      },
    });
    await petsCol().deleteMany({
      _id: {
        $in: [
          state.primaryPetId,
          state.secondaryPetId,
          state.deletedPetId,
          state.ngoPetId,
        ],
      },
    });
    await mongoose.disconnect();
  }
});

// ─── suite ───────────────────────────────────────────────────────────────────

describe('Tier 3 - /pet/adoption via SAM local + UAT DB', () => {
  beforeAll(async () => {
    await ensureSamLocalReachable();
  });

  test('denied-origin preflight is not provable in this env because env.json uses ALLOWED_ORIGINS=*', () => {
    expect(ALLOWED_ORIGINS).toBe('*');
  });

  // ── CORS / runtime boundary ──────────────────────────────────────────────────

  describe('runtime boundary behavior', () => {
    test('OPTIONS /pet/adoption returns 204 with CORS headers', async () => {
      const res = await req('OPTIONS', '/pet/adoption', undefined, { origin: VALID_ORIGIN });

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.headers['access-control-allow-headers']).toContain('x-api-key');
    });

    test('OPTIONS /pet/adoption/{id} returns 204 with CORS headers', async () => {
      const petId = new mongoose.Types.ObjectId().toString();
      const res = await req('OPTIONS', `/pet/adoption/${petId}`, undefined, { origin: VALID_ORIGIN });

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('*');
    });

    test('PUT /pet/adoption/{id} returns 405 or 403 (wrong method)', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'PUT',
        `/pet/adoption/${state.primaryPetId}`,
        { postAdoptionName: 'wrong method' },
        authHeaders(state.primaryToken)
      );

      // SAM/local API Gateway may intercept unrecognised methods before the
      // Lambda router. Both 403 (gateway) and 405 (router) are valid rejections.
      // The Lambda router 405 is proven at Tier 2.
      expect([403, 405]).toContain(res.status);
    });

    test('GET /pet/adoption/extra/nested/path is rejected before the Lambda (403 or 404)', async () => {
      const res = await req(
        'GET',
        '/pet/adoption/extra/nested/path',
        undefined,
        publicHeaders()
      );

      expect([403, 404]).toContain(res.status);
    });

    test('CORS headers are present on a normal 200 response', async () => {
      const res = await req('GET', '/pet/adoption', undefined, publicHeaders());

      // Browse list is public — should return 200 with CORS header present
      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('*');
    });
  });

  // ── Public browse list — GET /pet/adoption ──────────────────────────────────

  describe('GET /pet/adoption — public browse list', () => {
    test('returns 200 with expected shape', async () => {
      const res = await req('GET', '/pet/adoption', undefined, publicHeaders());

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.adoptionList)).toBe(true);
      expect(typeof res.body.totalResult).toBe('number');
      expect(typeof res.body.maxPage).toBe('number');
    });

    test('returns 200 with pagination when page=1 is provided', async () => {
      const res = await req('GET', '/pet/adoption?page=1', undefined, publicHeaders());

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.adoptionList)).toBe(true);
    });

    test('returns 400 for non-numeric page param', async () => {
      const res = await req('GET', '/pet/adoption?page=abc', undefined, publicHeaders());

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('petAdoption.errors.browse.invalidPage');
    });

    test('returns 400 for zero page param', async () => {
      const res = await req('GET', '/pet/adoption?page=0', undefined, publicHeaders());

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('petAdoption.errors.browse.invalidPage');
    });

    test('returns 400 when search param exceeds 100 chars', async () => {
      const longSearch = 'a'.repeat(101);
      const res = await req(
        'GET',
        `/pet/adoption?search=${encodeURIComponent(longSearch)}`,
        undefined,
        publicHeaders()
      );

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('petAdoption.errors.browse.invalidSearch');
    });

    test('returns 200 with search filter applied', async () => {
      const res = await req(
        'GET',
        '/pet/adoption?search=Dog',
        undefined,
        publicHeaders()
      );

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.adoptionList)).toBe(true);
    });

    test('returns 200 with animal_type filter', async () => {
      const res = await req(
        'GET',
        '/pet/adoption?animal_type=Dog',
        undefined,
        publicHeaders()
      );

      expect(res.status).toBe(200);
    });

    test('repeated GET requests are stable across warm invocations', async () => {
      const first = await req('GET', '/pet/adoption', undefined, publicHeaders());
      const second = await req('GET', '/pet/adoption', undefined, publicHeaders());

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(first.body.totalResult).toBe(second.body.totalResult);
    });
  });

  // ── Public browse detail — GET /pet/adoption/{id} (no auth) ─────────────────

  describe('GET /pet/adoption/{id} — public browse detail (no auth)', () => {
    test('returns 400 for non-ObjectId id', async () => {
      // With AUTH_BYPASS=true the authorizer injects a bypass identity even without
      // an Authorization header, so handleGetById dispatches to the managed path.
      // The managed handler validates the petId format first (before any DB call)
      // and returns the managed errorKey.
      const res = await req('GET', '/pet/adoption/not-a-valid-id', undefined, publicHeaders());

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('petAdoption.errors.managed.invalidPetId');
    });

    test('returns 200 or 404 for a valid ObjectId (no data guarantee for browse DB)', async () => {
      // With AUTH_BYPASS=true, requests without an Authorization header still receive
      // a bypass identity, so handleGetById dispatches to the managed path instead
      // of the public browse path. The managed path requires DB access.
      if (!(await ensureDbOrSkip())) return;

      const validId = new mongoose.Types.ObjectId().toString();
      const res = await req(`GET`, `/pet/adoption/${validId}`, undefined, publicHeaders());

      // Managed path: pet won't exist in the seeded fixture collection → 404.
      // A 200 is possible if the petId happens to collide with a seeded pet (extremely unlikely).
      expect([200, 404]).toContain(res.status);
    });
  });

  // ── Managed GET — GET /pet/adoption/{id} (with auth) ────────────────────────

  describe('GET /pet/adoption/{id} — managed record GET (with auth)', () => {
    test('returns form=null when no adoption record exists yet for the pet', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearAdoptionFor(state.primaryPetId);

      const res = await req(
        'GET',
        `/pet/adoption/${state.primaryPetId}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(200);
      expect(res.body.form).toBeNull();
      expect(String(res.body.petId)).toBe(String(state.primaryPetId));
    });

    test('returns the persisted form after a record is created', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearAdoptionFor(state.primaryPetId);

      const createRes = await req(
        'POST',
        `/pet/adoption/${state.primaryPetId}`,
        { postAdoptionName: 'Luna', isNeutered: true },
        authHeaders(state.primaryToken)
      );
      expect(createRes.status).toBe(201);

      const getRes = await req(
        'GET',
        `/pet/adoption/${state.primaryPetId}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(getRes.status).toBe(200);
      expect(getRes.body.form).not.toBeNull();
      expect(getRes.body.form.postAdoptionName).toBe('Luna');
      expect(getRes.body.form.isNeutered).toBe(true);
      expect(getRes.body.adoptionId).toBe(createRes.body.adoptionId);
    });

    test('returns 400 for invalid petId format', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'GET',
        '/pet/adoption/not-an-objectid',
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('petAdoption.errors.managed.invalidPetId');
    });

    test('returns 403 when caller reads another owner\'s managed record', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'GET',
        `/pet/adoption/${state.secondaryPetId}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(403);
      expect(res.body.errorKey).toBe('common.forbidden');
    });

    test('NGO-owned pet: NGO token succeeds, non-matching user token is denied', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearAdoptionFor(state.ngoPetId);

      const okRes = await req(
        'GET',
        `/pet/adoption/${state.ngoPetId}`,
        undefined,
        authHeaders(state.ngoToken)
      );
      expect(okRes.status).toBe(200);

      const denyRes = await req(
        'GET',
        `/pet/adoption/${state.ngoPetId}`,
        undefined,
        authHeaders(state.primaryToken)
      );
      expect(denyRes.status).toBe(403);
      expect(denyRes.body.errorKey).toBe('common.forbidden');
    });

    test('returns 404 when pet is soft-deleted', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'GET',
        `/pet/adoption/${state.deletedPetId}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(404);
      expect(res.body.errorKey).toBe('petAdoption.errors.managed.petNotFound');
    });
  });

  // ── Managed create — POST /pet/adoption/{id} ─────────────────────────────────

  describe('POST /pet/adoption/{id} — managed create', () => {
    test('creates a record and persists it to DB', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearAdoptionFor(state.primaryPetId);

      const res = await req(
        'POST',
        `/pet/adoption/${state.primaryPetId}`,
        {
          postAdoptionName: 'Mochi',
          isNeutered: false,
          firstVaccinationDate: '2024-03-01',
        },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(201);
      expect(res.body.adoptionId).toBeDefined();
      expect(String(res.body.petId)).toBe(String(state.primaryPetId));

      const adoptionOid = new mongoose.Types.ObjectId(res.body.adoptionId);
      const persisted = await adoptionsCol().findOne({ _id: adoptionOid });
      expect(persisted).not.toBeNull();
      expect(persisted.postAdoptionName).toBe('Mochi');
      expect(persisted.isNeutered).toBe(false);
      expect(persisted.petId).toBe(String(state.primaryPetId));
    });

    test('returns 201 with null optional fields when body is empty', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearAdoptionFor(state.primaryPetId);

      const res = await req(
        'POST',
        `/pet/adoption/${state.primaryPetId}`,
        {},
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(201);
      expect(res.body.adoptionId).toBeDefined();

      const adoptionOid = new mongoose.Types.ObjectId(res.body.adoptionId);
      const persisted = await adoptionsCol().findOne({ _id: adoptionOid });
      expect(persisted).not.toBeNull();
    });

    test('returns 409 on duplicate POST — only one record is persisted', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearAdoptionFor(state.primaryPetId);

      const first = await req(
        'POST',
        `/pet/adoption/${state.primaryPetId}`,
        { postAdoptionName: 'First' },
        authHeaders(state.primaryToken)
      );
      expect(first.status).toBe(201);

      const second = await req(
        'POST',
        `/pet/adoption/${state.primaryPetId}`,
        { postAdoptionName: 'Second' },
        authHeaders(state.primaryToken)
      );
      expect(second.status).toBe(409);
      expect(second.body.errorKey).toBe('petAdoption.errors.managed.duplicateRecord');

      const count = await adoptionsCol().countDocuments({
        petId: String(state.primaryPetId),
      });
      expect(count).toBe(1);
    });

    test('returns 400 for invalid date format in firstVaccinationDate', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearAdoptionFor(state.primaryPetId);

      const res = await req(
        'POST',
        `/pet/adoption/${state.primaryPetId}`,
        { firstVaccinationDate: 'not-a-date' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('petAdoption.errors.managed.invalidDateFormat');

      const persisted = await adoptionsCol().findOne({ petId: String(state.primaryPetId) });
      expect(persisted).toBeNull();
    });

    test('returns 400 for malformed JSON body', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'POST',
        `/pet/adoption/${state.primaryPetId}`,
        '{"postAdoptionName"',
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
    });

    test('returns 400 for invalid petId format', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'POST',
        '/pet/adoption/not-an-objectid',
        { postAdoptionName: 'Buddy' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('petAdoption.errors.managed.invalidPetId');
    });

    test('returns 403 when caller creates record for another owner\'s pet with no DB mutation', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearAdoptionFor(state.secondaryPetId);

      const res = await req(
        'POST',
        `/pet/adoption/${state.secondaryPetId}`,
        { postAdoptionName: 'Hijack' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(403);
      expect(res.body.errorKey).toBe('common.forbidden');

      const persisted = await adoptionsCol().findOne({
        petId: String(state.secondaryPetId),
      });
      expect(persisted).toBeNull();
    });

    test('returns 404 when pet is soft-deleted, with no record created', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearAdoptionFor(state.deletedPetId);

      const res = await req(
        'POST',
        `/pet/adoption/${state.deletedPetId}`,
        { postAdoptionName: 'Ghost' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(404);

      const persisted = await adoptionsCol().findOne({
        petId: String(state.deletedPetId),
      });
      expect(persisted).toBeNull();
    });
  });

  // ── Managed update — PATCH /pet/adoption/{id} ────────────────────────────────

  describe('PATCH /pet/adoption/{id} — managed update', () => {
    test('updates only the provided fields and DB reflects the change', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearAdoptionFor(state.primaryPetId);

      const createRes = await req(
        'POST',
        `/pet/adoption/${state.primaryPetId}`,
        { postAdoptionName: 'Original', isNeutered: false },
        authHeaders(state.primaryToken)
      );
      expect(createRes.status).toBe(201);
      const adoptionOid = new mongoose.Types.ObjectId(createRes.body.adoptionId);

      const patchRes = await req(
        'PATCH',
        `/pet/adoption/${state.primaryPetId}`,
        { isNeutered: true, NeuteredDate: '2024-06-15' },
        authHeaders(state.primaryToken)
      );

      expect(patchRes.status).toBe(200);

      const persisted = await adoptionsCol().findOne({ _id: adoptionOid });
      expect(persisted.isNeutered).toBe(true);
      expect(persisted.postAdoptionName).toBe('Original');
    });

    test('returns 400 when body has no recognized update fields', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearAdoptionFor(state.primaryPetId);

      await req(
        'POST',
        `/pet/adoption/${state.primaryPetId}`,
        { postAdoptionName: 'Seed' },
        authHeaders(state.primaryToken)
      );

      const res = await req(
        'PATCH',
        `/pet/adoption/${state.primaryPetId}`,
        {},
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
    });

    test('returns 400 for invalid date format in update body', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearAdoptionFor(state.primaryPetId);

      await req(
        'POST',
        `/pet/adoption/${state.primaryPetId}`,
        { postAdoptionName: 'Seed' },
        authHeaders(state.primaryToken)
      );

      const res = await req(
        'PATCH',
        `/pet/adoption/${state.primaryPetId}`,
        { NeuteredDate: 'bad-date' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('petAdoption.errors.managed.invalidDateFormat');
    });

    test('returns 404 when no adoption record exists for the petId', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearAdoptionFor(state.primaryPetId);

      const res = await req(
        'PATCH',
        `/pet/adoption/${state.primaryPetId}`,
        { postAdoptionName: 'Update without record' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(404);
      expect(res.body.errorKey).toBe('petAdoption.errors.managed.recordNotFound');
    });

    test('returns 403 when caller updates another owner\'s record with no DB mutation', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearAdoptionFor(state.secondaryPetId);

      // Seed a record for the secondary pet via direct DB write
      await adoptionsCol().insertOne({
        petId: String(state.secondaryPetId),
        postAdoptionName: 'SecondaryOwned',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await req(
        'PATCH',
        `/pet/adoption/${state.secondaryPetId}`,
        { postAdoptionName: 'Stolen Update' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(403);
      expect(res.body.errorKey).toBe('common.forbidden');

      const persisted = await adoptionsCol().findOne({
        petId: String(state.secondaryPetId),
      });
      expect(persisted.postAdoptionName).toBe('SecondaryOwned');
    });
  });

  // ── Managed delete — DELETE /pet/adoption/{id} ───────────────────────────────

  describe('DELETE /pet/adoption/{id} — managed delete', () => {
    test('deletes the record and it no longer exists in DB', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearAdoptionFor(state.primaryPetId);

      const createRes = await req(
        'POST',
        `/pet/adoption/${state.primaryPetId}`,
        { postAdoptionName: 'ToDelete' },
        authHeaders(state.primaryToken)
      );
      expect(createRes.status).toBe(201);
      const adoptionOid = new mongoose.Types.ObjectId(createRes.body.adoptionId);

      const deleteRes = await req(
        'DELETE',
        `/pet/adoption/${state.primaryPetId}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.petId).toBeDefined();

      const persisted = await adoptionsCol().findOne({ _id: adoptionOid });
      expect(persisted).toBeNull();
    });

    test('GET after DELETE returns form=null', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearAdoptionFor(state.primaryPetId);

      await req(
        'POST',
        `/pet/adoption/${state.primaryPetId}`,
        { postAdoptionName: 'WillBeDeleted' },
        authHeaders(state.primaryToken)
      );

      await req(
        'DELETE',
        `/pet/adoption/${state.primaryPetId}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      const getRes = await req(
        'GET',
        `/pet/adoption/${state.primaryPetId}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(getRes.status).toBe(200);
      expect(getRes.body.form).toBeNull();
    });

    test('returns 404 when no record exists to delete', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearAdoptionFor(state.primaryPetId);

      const res = await req(
        'DELETE',
        `/pet/adoption/${state.primaryPetId}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(404);
      expect(res.body.errorKey).toBe('petAdoption.errors.managed.recordNotFound');
    });

    test('returns 403 when caller deletes another owner\'s record with no DB mutation', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearAdoptionFor(state.secondaryPetId);

      await adoptionsCol().insertOne({
        petId: String(state.secondaryPetId),
        postAdoptionName: 'DoNotDelete',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await req(
        'DELETE',
        `/pet/adoption/${state.secondaryPetId}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(403);
      expect(res.body.errorKey).toBe('common.forbidden');

      const persisted = await adoptionsCol().findOne({
        petId: String(state.secondaryPetId),
      });
      expect(persisted).not.toBeNull();
      expect(persisted.postAdoptionName).toBe('DoNotDelete');
    });
  });

  // ── Authentication and authorisation ────────────────────────────────────────

  describe('authentication and authorisation', () => {
    test('POST /pet/adoption/{id} rejects a missing Authorization header', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'POST',
        `/pet/adoption/${state.primaryPetId}`,
        { postAdoptionName: 'Anon' },
        { 'x-api-key': API_KEY, origin: VALID_ORIGIN }
      );

      expect(expectedUnauthenticatedStatuses()).toContain(res.status);
    });

    test('POST /pet/adoption/{id} rejects a garbage bearer token', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'POST',
        `/pet/adoption/${state.primaryPetId}`,
        { postAdoptionName: 'Anon' },
        authHeaders('this.is.garbage')
      );

      expect([401, 403]).toContain(res.status);
    });

    test('POST /pet/adoption/{id} rejects an expired JWT', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const expiredToken = signToken({ userId: state.primaryUserId, expiresIn: -60 });
      const res = await req(
        'POST',
        `/pet/adoption/${state.primaryPetId}`,
        { postAdoptionName: 'Expired' },
        authHeaders(expiredToken)
      );

      expect([401, 403]).toContain(res.status);
    });

    test('POST /pet/adoption/{id} rejects a tampered JWT', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const tampered = `${state.primaryToken.slice(0, -1)}${
        state.primaryToken.slice(-1) === 'a' ? 'b' : 'a'
      }`;
      const res = await req(
        'POST',
        `/pet/adoption/${state.primaryPetId}`,
        { postAdoptionName: 'Tampered' },
        authHeaders(tampered)
      );

      expect([401, 403]).toContain(res.status);
    });

    test('POST /pet/adoption/{id} rejects an alg:none JWT attack', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const algNone = buildAlgNoneToken({ userId: state.primaryUserId });
      const res = await req(
        'POST',
        `/pet/adoption/${state.primaryPetId}`,
        { postAdoptionName: 'AlgNone' },
        authHeaders(algNone)
      );

      expect([401, 403]).toContain(res.status);
    });

    test('PATCH /pet/adoption/{id} rejects a missing Authorization header', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'PATCH',
        `/pet/adoption/${state.primaryPetId}`,
        { postAdoptionName: 'Anon' },
        { 'x-api-key': API_KEY, origin: VALID_ORIGIN }
      );

      expect(expectedUnauthenticatedStatuses()).toContain(res.status);
    });

    test('DELETE /pet/adoption/{id} rejects a missing Authorization header', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'DELETE',
        `/pet/adoption/${state.primaryPetId}`,
        undefined,
        { 'x-api-key': API_KEY, origin: VALID_ORIGIN }
      );

      expect(expectedUnauthenticatedStatuses()).toContain(res.status);
    });
  });

  // ── Cyberattacks ─────────────────────────────────────────────────────────────

  describe('cyberattacks', () => {
    test('POST /pet/adoption/{id} rejects mass-assignment of unknown fields and does not persist them', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearAdoptionFor(state.primaryPetId);

      const res = await req(
        'POST',
        `/pet/adoption/${state.primaryPetId}`,
        {
          postAdoptionName: 'Legit',
          deleted: true,
          petId: state.secondaryPetId.toString(),
          _id: new mongoose.Types.ObjectId().toString(),
          isAdmin: true,
        },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);

      const persisted = await adoptionsCol().findOne({
        petId: String(state.primaryPetId),
      });
      expect(persisted).toBeNull();
    });

    test('PATCH /pet/adoption/{id} rejects NoSQL operator injection in postAdoptionName, DB unchanged', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearAdoptionFor(state.primaryPetId);

      const createRes = await req(
        'POST',
        `/pet/adoption/${state.primaryPetId}`,
        { postAdoptionName: 'Untouched' },
        authHeaders(state.primaryToken)
      );
      expect(createRes.status).toBe(201);
      const adoptionOid = new mongoose.Types.ObjectId(createRes.body.adoptionId);

      const before = await adoptionsCol().findOne({ _id: adoptionOid });

      const res = await req(
        'PATCH',
        `/pet/adoption/${state.primaryPetId}`,
        { postAdoptionName: { $gt: '' } },
        authHeaders(state.primaryToken)
      );

      const after = await adoptionsCol().findOne({ _id: adoptionOid });

      expect(res.status).toBe(400);
      expect(after.postAdoptionName).toBe(before.postAdoptionName);
    });

    test('PATCH /pet/adoption/{id} rejects mass-assignment of unknown fields without mutating DB', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearAdoptionFor(state.primaryPetId);

      const createRes = await req(
        'POST',
        `/pet/adoption/${state.primaryPetId}`,
        { postAdoptionName: 'Original' },
        authHeaders(state.primaryToken)
      );
      expect(createRes.status).toBe(201);
      const adoptionOid = new mongoose.Types.ObjectId(createRes.body.adoptionId);

      const res = await req(
        'PATCH',
        `/pet/adoption/${state.primaryPetId}`,
        { postAdoptionName: 'Allowed', isAdmin: true, deleted: true, __v: 99 },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);

      const persisted = await adoptionsCol().findOne({ _id: adoptionOid });
      expect(persisted.postAdoptionName).toBe('Original');
      expect(persisted.isAdmin).toBeUndefined();
      expect(persisted.deleted).toBeUndefined();
    });

    test('replayed duplicate POST returns 409 and only one record persists', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearAdoptionFor(state.primaryPetId);

      const body = { postAdoptionName: 'Replay' };

      const first = await req(
        'POST',
        `/pet/adoption/${state.primaryPetId}`,
        body,
        authHeaders(state.primaryToken)
      );
      expect(first.status).toBe(201);

      const replay = await req(
        'POST',
        `/pet/adoption/${state.primaryPetId}`,
        body,
        authHeaders(state.primaryToken)
      );
      expect(replay.status).toBe(409);

      const count = await adoptionsCol().countDocuments({
        petId: String(state.primaryPetId),
      });
      expect(count).toBe(1);
    });

    test('repeated hostile PATCH attempts are stable and do not corrupt DB state', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearAdoptionFor(state.primaryPetId);

      const createRes = await req(
        'POST',
        `/pet/adoption/${state.primaryPetId}`,
        { postAdoptionName: 'Original' },
        authHeaders(state.primaryToken)
      );
      expect(createRes.status).toBe(201);
      const adoptionOid = new mongoose.Types.ObjectId(createRes.body.adoptionId);

      const first = await req(
        'PATCH',
        `/pet/adoption/${state.primaryPetId}`,
        { isAdmin: true },
        authHeaders(state.primaryToken)
      );
      const second = await req(
        'PATCH',
        `/pet/adoption/${state.primaryPetId}`,
        { isAdmin: true },
        authHeaders(state.primaryToken)
      );

      expect(first.status).toBe(400);
      expect(second.status).toBe(400);

      const persisted = await adoptionsCol().findOne({ _id: adoptionOid });
      expect(persisted.postAdoptionName).toBe('Original');
      expect(persisted.isAdmin).toBeUndefined();
    });

    test('cross-owner POST attempt from secondary token leaves no orphan record', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearAdoptionFor(state.primaryPetId);

      const res = await req(
        'POST',
        `/pet/adoption/${state.primaryPetId}`,
        { postAdoptionName: 'Hijacked' },
        authHeaders(state.secondaryToken)
      );

      expect(res.status).toBe(403);

      const persisted = await adoptionsCol().findOne({
        petId: String(state.primaryPetId),
      });
      expect(persisted).toBeNull();
    });
  });

  // ── Sequential state changes ─────────────────────────────────────────────────

  describe('sequential state changes', () => {
    test('create → update → delete → GET returns null form', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearAdoptionFor(state.primaryPetId);

      const createRes = await req(
        'POST',
        `/pet/adoption/${state.primaryPetId}`,
        { postAdoptionName: 'Lifecycle' },
        authHeaders(state.primaryToken)
      );
      expect(createRes.status).toBe(201);
      const adoptionOid = new mongoose.Types.ObjectId(createRes.body.adoptionId);

      const patchRes = await req(
        'PATCH',
        `/pet/adoption/${state.primaryPetId}`,
        { isNeutered: true },
        authHeaders(state.primaryToken)
      );
      expect(patchRes.status).toBe(200);

      const afterPatch = await adoptionsCol().findOne({ _id: adoptionOid });
      expect(afterPatch.isNeutered).toBe(true);
      expect(afterPatch.postAdoptionName).toBe('Lifecycle');

      const deleteRes = await req(
        'DELETE',
        `/pet/adoption/${state.primaryPetId}`,
        undefined,
        authHeaders(state.primaryToken)
      );
      expect(deleteRes.status).toBe(200);

      const afterDelete = await adoptionsCol().findOne({ _id: adoptionOid });
      expect(afterDelete).toBeNull();

      const getRes = await req(
        'GET',
        `/pet/adoption/${state.primaryPetId}`,
        undefined,
        authHeaders(state.primaryToken)
      );
      expect(getRes.status).toBe(200);
      expect(getRes.body.form).toBeNull();
    });

    test('PATCH after DELETE returns 404 and does not recreate the record', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearAdoptionFor(state.primaryPetId);

      await req(
        'POST',
        `/pet/adoption/${state.primaryPetId}`,
        { postAdoptionName: 'WillBeDeleted' },
        authHeaders(state.primaryToken)
      );

      await req(
        'DELETE',
        `/pet/adoption/${state.primaryPetId}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      const patchRes = await req(
        'PATCH',
        `/pet/adoption/${state.primaryPetId}`,
        { postAdoptionName: 'GhostUpdate' },
        authHeaders(state.primaryToken)
      );

      expect(patchRes.status).toBe(404);

      const persisted = await adoptionsCol().findOne({
        petId: String(state.primaryPetId),
        postAdoptionName: 'GhostUpdate',
      });
      expect(persisted).toBeNull();
    });

    test('warm repeated GETs are stable and return consistent data', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearAdoptionFor(state.primaryPetId);

      const first = await req(
        'GET',
        `/pet/adoption/${state.primaryPetId}`,
        undefined,
        authHeaders(state.primaryToken)
      );
      const second = await req(
        'GET',
        `/pet/adoption/${state.primaryPetId}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(first.body.form).toBeNull();
      expect(second.body.form).toBeNull();
    });
  });

  // ── Deferred ─────────────────────────────────────────────────────────────────

  describe('deferred — requires live AWS or unavailable infra', () => {
    test.todo('parallel duplicate POST requests honor the unique petId constraint under concurrency (requires load harness)');
    test.todo('deployed AWS verification: API Gateway authorizer deny prevents this Lambda from running');
    test.todo('deployed AWS verification: requestContext.authorizer is injected correctly by live API Gateway');
    test.todo('public browse list and detail tests against real adoption_list data (requires browse DB seed harness)');
  });
});
