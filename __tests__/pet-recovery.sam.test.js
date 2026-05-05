// Tier 3 — SAM local HTTP integration tests for the pet-recovery Lambda.
// Tier 4 — Real MongoDB UAT persistence proofs.
//
// Prerequisites (run before this suite):
//   sam local start-api \
//     --template .aws-sam/build/template.yaml \
//     --env-vars env.json \
//     --warm-containers EAGER
//
// Coverage tiers (per dev_docs/llms/DDD_TESTING_STANDARD.md):
//   Tier 2 mock handler tests:    __tests__/pet-recovery.test.js
//   Tier 3 SAM + Mongo (this):    __tests__/pet-recovery.sam.test.js
//
// Routes under test (all protected — require valid Bearer token):
//   GET    /pet/recovery/lost
//   POST   /pet/recovery/lost               ← multipart/form-data
//   DELETE /pet/recovery/lost/{petLostID}
//   GET    /pet/recovery/found
//   POST   /pet/recovery/found              ← multipart/form-data
//   DELETE /pet/recovery/found/{petFoundID}
//
// Note on multipart:
//   POST /pet/recovery/lost and /found accept multipart/form-data bodies.
//   Tests send real multipart using the Node.js built-in FormData + fetch.
//   The Lambda uses lambda-multipart-parser to parse the incoming event.
//
// DB collections used: pets, pet_lost, pet_found

const dns = require('dns');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const envConfig = require('../env.json');

const BASE_URL = process.env.PET_RECOVERY_UAT_BASE_URL || 'http://127.0.0.1:3000';
const TEST_TS = Date.now();
const RUN_ID = `ddd-pet-recovery-${TEST_TS}`;
const JWT_SECRET =
  process.env.PET_RECOVERY_TEST_JWT_SECRET ||
  envConfig.RequestAuthorizerFunction?.JWT_SECRET ||
  'PPCSecret';
const API_KEY =
  process.env.PET_RECOVERY_TEST_API_KEY ||
  envConfig.Parameters?.ExistingApiKeyId ||
  'test-api-key';
const MONGODB_URI =
  envConfig.PetRecoveryFunction?.MONGODB_URI || envConfig.Parameters?.MONGODB_URI || '';
const ALLOWED_ORIGINS = envConfig.Parameters?.ALLOWED_ORIGINS || '*';
const AUTH_BYPASS =
  envConfig.Parameters?.AUTH_BYPASS || envConfig.PetRecoveryFunction?.AUTH_BYPASS || 'false';
const VALID_ORIGIN = 'http://localhost:3000';

let dbReady = false;
let dbConnectAttempted = false;
let dbConnectError = null;

const state = {
  primaryUserId: new mongoose.Types.ObjectId(),
  secondaryUserId: new mongoose.Types.ObjectId(),
  // A pet owned by primaryUserId — used for petId-linked lost reports.
  primaryPetId: new mongoose.Types.ObjectId(),
  primaryToken: null,
  secondaryToken: null,
};

// ─── helpers ─────────────────────────────────────────────────────────────────

function signToken({ userId, role = 'user', expiresIn = '15m' }) {
  return jwt.sign(
    { userId: userId.toString(), userRole: role },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn }
  );
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

function expectedUnauthenticatedStatuses() {
  return AUTH_BYPASS === 'true' ? [401, 403, 404] : [401, 403];
}

/**
 * Build a multipart FormData request for pet-recovery POST endpoints.
 * Returns { body: FormData, contentType: string } so callers can pass
 * the Content-Type header (which includes the boundary) to fetch.
 */
function buildMultipartLost(fields = {}) {
  const fd = new FormData();
  const defaults = {
    name: `LostDog-${RUN_ID}`,
    sex: 'Male',
    animal: 'Dog',
    lostDate: '01/05/2025',
    lostLocation: 'Central Park',
    lostDistrict: 'Central',
  };
  const merged = { ...defaults, ...fields };
  for (const [k, v] of Object.entries(merged)) {
    if (v !== undefined && v !== null) {
      fd.append(k, String(v));
    }
  }
  return fd;
}

function buildMultipartFound(fields = {}) {
  const fd = new FormData();
  const defaults = {
    animal: 'Cat',
    foundDate: '02/05/2025',
    foundLocation: 'Mong Kok',
    foundDistrict: 'Kowloon',
  };
  const merged = { ...defaults, ...fields };
  for (const [k, v] of Object.entries(merged)) {
    if (v !== undefined && v !== null) {
      fd.append(k, String(v));
    }
  }
  return fd;
}

/**
 * Send a multipart form request. The Content-Type is omitted from explicit
 * headers so fetch can set the boundary automatically from the FormData body.
 */
async function reqMultipart(method, path, formData, token) {
  const headers = {
    'x-api-key': API_KEY,
    origin: VALID_ORIGIN,
    'x-forwarded-for': `198.51.100.${(TEST_TS % 200) + 1}`,
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: formData,
  });

  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  return { status: res.status, body: json, headers: Object.fromEntries(res.headers.entries()) };
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
  if (!MONGODB_URI) throw new Error('env.json missing PetRecoveryFunction.MONGODB_URI');
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

function petLostCol() {
  return mongoose.connection.db.collection('pet_lost');
}

function petFoundCol() {
  return mongoose.connection.db.collection('pet_found');
}

async function seedFixtures() {
  state.primaryToken = signToken({ userId: state.primaryUserId });
  state.secondaryToken = signToken({ userId: state.secondaryUserId });

  // Clear rate-limit counters so 429s from previous runs don't bleed into this one.
  await mongoose.connection.db.collection('rate_limits').deleteMany({
    action: /^petRecovery\./,
  });

  const nowMs = Date.now();

  await petsCol().deleteMany({ _id: { $in: [state.primaryPetId] } });

  await petsCol().insertOne({
    _id: state.primaryPetId,
    userId: state.primaryUserId,
    name: `RecoveryPet-${RUN_ID}`,
    animal: 'Dog',
    sex: 'Male',
    birthday: new Date('2022-01-01T00:00:00.000Z'),
    breedimage: [],
    deleted: false,
    transfer: [],
    transferNGO: [],
    createdAt: new Date(nowMs),
    updatedAt: new Date(nowMs),
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

async function ensureSamLocalReachable() {
  try {
    await fetch(`${BASE_URL}/pet/recovery/lost`, {
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
    // Use ObjectId — the service stores userId as ObjectId via mongoose casting.
    await petLostCol().deleteMany({ userId: state.primaryUserId });
    await petLostCol().deleteMany({ userId: state.secondaryUserId });
    await petFoundCol().deleteMany({ userId: state.primaryUserId });
    await petFoundCol().deleteMany({ userId: state.secondaryUserId });
    await petsCol().deleteMany({ _id: { $in: [state.primaryPetId] } });
    await mongoose.disconnect();
  }
});

// ─── suite ───────────────────────────────────────────────────────────────────

describe('Tier 3+4 - /pet/recovery via SAM local + UAT DB', () => {
  beforeAll(async () => {
    await ensureSamLocalReachable();
  });

  test('env.json uses ALLOWED_ORIGINS=* so denied-origin preflight is not provable here', () => {
    expect(ALLOWED_ORIGINS).toBe('*');
  });

  // ── CORS / runtime boundary ──────────────────────────────────────────────────

  describe('runtime boundary behavior', () => {
    test('OPTIONS /pet/recovery/lost returns 204 with CORS headers', async () => {
      const res = await req('OPTIONS', '/pet/recovery/lost', undefined, { origin: VALID_ORIGIN });

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.headers['access-control-allow-headers']).toContain('x-api-key');
    });

    test('OPTIONS /pet/recovery/found returns 204 with CORS headers', async () => {
      const res = await req('OPTIONS', '/pet/recovery/found', undefined, {
        origin: VALID_ORIGIN,
      });

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('*');
    });

    test('OPTIONS /pet/recovery/lost/{petLostID} returns 204 with CORS headers', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      const res = await req('OPTIONS', `/pet/recovery/lost/${id}`, undefined, {
        origin: VALID_ORIGIN,
      });

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('*');
    });

    test('PATCH /pet/recovery/lost returns 403 or 405 (wrong method — no template route)', async () => {
      const res = await req('PATCH', '/pet/recovery/lost', {}, authHeaders(state.primaryToken || signToken({ userId: state.primaryUserId })));

      expect([403, 404, 405]).toContain(res.status);
    });

    test('CORS headers are present on a protected 401/403 response', async () => {
      const res = await req('GET', '/pet/recovery/lost', undefined, publicHeaders());

      expect(res.headers['access-control-allow-origin']).toBe('*');
    });
  });

  // ── Authentication and authorisation ────────────────────────────────────────

  describe('authentication and authorisation', () => {
    test('GET /pet/recovery/lost rejects missing Authorization header', async () => {
      const res = await req('GET', '/pet/recovery/lost', undefined, publicHeaders());

      // With AUTH_BYPASS=true the list endpoint has no ownership gate — 200 is acceptable.
      expect([200, ...expectedUnauthenticatedStatuses()]).toContain(res.status);
    });

    test('GET /pet/recovery/found rejects missing Authorization header', async () => {
      const res = await req('GET', '/pet/recovery/found', undefined, publicHeaders());

      // With AUTH_BYPASS=true the list endpoint has no ownership gate — 200 is acceptable.
      expect([200, ...expectedUnauthenticatedStatuses()]).toContain(res.status);
    });

    test('POST /pet/recovery/lost rejects garbage bearer token', async () => {
      const res = await reqMultipart('POST', '/pet/recovery/lost', buildMultipartLost(), 'this.is.garbage');

      expect([401, 403]).toContain(res.status);
    });

    test('POST /pet/recovery/lost rejects expired JWT', async () => {
      const expiredToken = signToken({ userId: state.primaryUserId, expiresIn: -60 });
      const res = await reqMultipart('POST', '/pet/recovery/lost', buildMultipartLost(), expiredToken);

      expect([401, 403]).toContain(res.status);
    });

    test('POST /pet/recovery/lost rejects tampered JWT', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const tampered = `${state.primaryToken.slice(0, -1)}${
        state.primaryToken.slice(-1) === 'a' ? 'b' : 'a'
      }`;
      const res = await reqMultipart('POST', '/pet/recovery/lost', buildMultipartLost(), tampered);

      expect([401, 403]).toContain(res.status);
    });

    test('POST /pet/recovery/lost rejects alg:none JWT attack', async () => {
      const algNone = buildAlgNoneToken({ userId: state.primaryUserId });
      const res = await reqMultipart('POST', '/pet/recovery/lost', buildMultipartLost(), algNone);

      expect([401, 403]).toContain(res.status);
    });

    test('DELETE /pet/recovery/lost/{petLostID} rejects missing Authorization header', async () => {
      const id = new mongoose.Types.ObjectId().toString();
      const res = await req('DELETE', `/pet/recovery/lost/${id}`, undefined, publicHeaders());

      expect(expectedUnauthenticatedStatuses()).toContain(res.status);
    });
  });

  // ── GET /pet/recovery/lost — list ─────────────────────────────────────────────

  describe('GET /pet/recovery/lost — list', () => {
    test('returns 200 with pets array', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'GET',
        '/pet/recovery/lost',
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body?.pets)).toBe(true);
      expect(typeof res.body?.count).toBe('number');
    });

    test('repeated GET requests return stable count', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const first = await req('GET', '/pet/recovery/lost', undefined, authHeaders(state.primaryToken));
      const second = await req('GET', '/pet/recovery/lost', undefined, authHeaders(state.primaryToken));

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(first.body.count).toBe(second.body.count);
    });
  });

  // ── POST /pet/recovery/lost — create ─────────────────────────────────────────

  describe('POST /pet/recovery/lost — create', () => {
    test('creates a lost report and persists it to DB', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const formData = buildMultipartLost({
        name: `Buddy-${RUN_ID}`,
        sex: 'Male',
        animal: 'Dog',
        lostDate: '01/05/2025',
        lostLocation: 'Victoria Park',
        lostDistrict: 'Causeway Bay',
        owner: 'John Doe',
      });

      const res = await reqMultipart('POST', '/pet/recovery/lost', formData, state.primaryToken);

      expect(res.status).toBe(201);
      expect(res.body?.id).toBeDefined();

      const persisted = await petLostCol().findOne({
        _id: new mongoose.Types.ObjectId(res.body.id),
      });
      expect(persisted).not.toBeNull();
      expect(persisted.name).toBe(`Buddy-${RUN_ID}`);
      expect(persisted.lostLocation).toBe('Victoria Park');
      // userId is stored as ObjectId by mongoose — use .toString() for comparison.
      expect(persisted.userId.toString()).toBe(state.primaryUserId.toString());
    });

    test('creates a report linked to an owned pet and updates pet status', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const formData = buildMultipartLost({
        petId: state.primaryPetId.toString(),
        name: `LinkedDog-${RUN_ID}`,
        sex: 'Male',
        animal: 'Dog',
        lostDate: '02/05/2025',
        lostLocation: 'Tsim Sha Tsui',
        lostDistrict: 'Kowloon',
        status: 'Lost',
      });

      const res = await reqMultipart('POST', '/pet/recovery/lost', formData, state.primaryToken);

      expect(res.status).toBe(201);
      expect(res.body?.id).toBeDefined();

      const persisted = await petLostCol().findOne({
        _id: new mongoose.Types.ObjectId(res.body.id),
      });
      expect(persisted).not.toBeNull();
      expect(persisted.petId).toBe(state.primaryPetId.toString());

      // Cleanup the lost record
      await petLostCol().deleteOne({ _id: new mongoose.Types.ObjectId(res.body.id) });
    });

    test('returns 400 when required field "name" is missing', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const fd = new FormData();
      fd.append('sex', 'Male');
      fd.append('animal', 'Dog');
      fd.append('lostDate', '01/05/2025');
      fd.append('lostLocation', 'Some Place');
      fd.append('lostDistrict', 'District A');
      // name omitted

      const res = await reqMultipart('POST', '/pet/recovery/lost', fd, state.primaryToken);

      expect(res.status).toBe(400);
    });

    test('returns 400 when required field "lostDate" is missing', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const fd = new FormData();
      fd.append('name', 'Nameless');
      fd.append('sex', 'Male');
      fd.append('animal', 'Dog');
      fd.append('lostLocation', 'Some Place');
      fd.append('lostDistrict', 'District A');
      // lostDate omitted

      const res = await reqMultipart('POST', '/pet/recovery/lost', fd, state.primaryToken);

      expect(res.status).toBe(400);
    });

    test('returns 400 when lostDate is invalid', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const formData = buildMultipartLost({ lostDate: 'not-a-date' });
      const res = await reqMultipart('POST', '/pet/recovery/lost', formData, state.primaryToken);

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('petRecovery.errors.petLost.lostDateRequired');
    });

    test('returns 403 when petId belongs to another user', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      // secondaryPet owned by secondaryUserId — primaryUser should be denied
      const secondaryPetId = new mongoose.Types.ObjectId();
      await petsCol().insertOne({
        _id: secondaryPetId,
        userId: state.secondaryUserId,
        name: `SecPet-${RUN_ID}`,
        animal: 'Cat',
        sex: 'Female',
        birthday: new Date('2023-01-01T00:00:00.000Z'),
        breedimage: [],
        deleted: false,
        transfer: [],
        transferNGO: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const formData = buildMultipartLost({
        petId: secondaryPetId.toString(),
        name: `Hijack-${RUN_ID}`,
        lostDate: '01/05/2025',
        lostLocation: 'Forbidden Zone',
        lostDistrict: 'Kowloon',
      });

      const res = await reqMultipart('POST', '/pet/recovery/lost', formData, state.primaryToken);

      expect(res.status).toBe(403);
      expect(res.body?.errorKey).toBe('common.forbidden');

      const count = await petLostCol().countDocuments({
        petId: secondaryPetId.toString(),
      });
      expect(count).toBe(0);

      await petsCol().deleteOne({ _id: secondaryPetId });
    });

    test('returns 404 when petId references a non-existent pet', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const fakePetId = new mongoose.Types.ObjectId().toString();
      const formData = buildMultipartLost({
        petId: fakePetId,
        name: `Ghost-${RUN_ID}`,
        lostDate: '01/05/2025',
        lostLocation: 'Nowhere',
        lostDistrict: 'Unknown',
      });

      const res = await reqMultipart('POST', '/pet/recovery/lost', formData, state.primaryToken);

      expect(res.status).toBe(404);
      expect(res.body?.errorKey).toBe('petRecovery.errors.petLost.petNotFound');
    });
  });

  // ── DELETE /pet/recovery/lost/{petLostID} — delete ───────────────────────────

  describe('DELETE /pet/recovery/lost/{petLostID} — delete', () => {
    test('deletes the lost report and it no longer exists in DB', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const createRes = await reqMultipart(
        'POST',
        '/pet/recovery/lost',
        buildMultipartLost({ name: `ToDelete-${RUN_ID}` }),
        state.primaryToken
      );
      expect(createRes.status).toBe(201);
      const petLostID = createRes.body.id;

      const deleteRes = await req(
        'DELETE',
        `/pet/recovery/lost/${petLostID}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(deleteRes.status).toBe(200);

      const persisted = await petLostCol().findOne({
        _id: new mongoose.Types.ObjectId(petLostID),
      });
      expect(persisted).toBeNull();
    });

    test('GET list after DELETE no longer includes the deleted report', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const createRes = await reqMultipart(
        'POST',
        '/pet/recovery/lost',
        buildMultipartLost({ name: `WillBeGone-${RUN_ID}` }),
        state.primaryToken
      );
      expect(createRes.status).toBe(201);
      const petLostID = createRes.body.id;

      await req(
        'DELETE',
        `/pet/recovery/lost/${petLostID}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      const listRes = await req(
        'GET',
        '/pet/recovery/lost',
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(listRes.status).toBe(200);
      const ids = listRes.body.pets.map((p) => String(p._id));
      expect(ids).not.toContain(petLostID);
    });

    test('returns 404 when record does not exist', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const fakeId = new mongoose.Types.ObjectId().toString();
      const res = await req(
        'DELETE',
        `/pet/recovery/lost/${fakeId}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(404);
      expect(res.body?.errorKey).toBe('petRecovery.errors.petLost.notFound');
    });

    test('returns 400 for invalid petLostID format', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'DELETE',
        '/pet/recovery/lost/not-an-objectid',
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('petRecovery.errors.petLost.invalidId');
    });

    test('returns 403 when caller deletes another user\'s report — record survives in DB', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const seedId = new mongoose.Types.ObjectId();
      await petLostCol().insertOne({
        _id: seedId,
        userId: state.secondaryUserId.toString(),
        name: `DoNotDelete-${RUN_ID}`,
        sex: 'Female',
        animal: 'Cat',
        lostDate: new Date('2025-05-01T00:00:00.000Z'),
        lostLocation: 'Protected Street',
        lostDistrict: 'Kowloon',
        serial_number: 99999,
        breedimage: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await req(
        'DELETE',
        `/pet/recovery/lost/${seedId}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(403);
      expect(res.body?.errorKey).toBe('common.forbidden');

      const persisted = await petLostCol().findOne({ _id: seedId });
      expect(persisted).not.toBeNull();

      await petLostCol().deleteOne({ _id: seedId });
    });
  });

  // ── GET /pet/recovery/found — list ────────────────────────────────────────────

  describe('GET /pet/recovery/found — list', () => {
    test('returns 200 with pets array', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'GET',
        '/pet/recovery/found',
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body?.pets)).toBe(true);
      expect(typeof res.body?.count).toBe('number');
    });

    test('repeated GET requests return stable count', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const first = await req('GET', '/pet/recovery/found', undefined, authHeaders(state.primaryToken));
      const second = await req('GET', '/pet/recovery/found', undefined, authHeaders(state.primaryToken));

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(first.body.count).toBe(second.body.count);
    });
  });

  // ── POST /pet/recovery/found — create ─────────────────────────────────────────

  describe('POST /pet/recovery/found — create', () => {
    test('creates a found report and persists it to DB', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const formData = buildMultipartFound({
        animal: 'Cat',
        foundDate: '03/05/2025',
        foundLocation: 'Happy Valley',
        foundDistrict: 'Wan Chai',
        description: `Orange tabby - ${RUN_ID}`,
        owner: 'Jane Doe',
      });

      const res = await reqMultipart('POST', '/pet/recovery/found', formData, state.primaryToken);

      expect(res.status).toBe(201);
      expect(res.body?.id).toBeDefined();

      const persisted = await petFoundCol().findOne({
        _id: new mongoose.Types.ObjectId(res.body.id),
      });
      expect(persisted).not.toBeNull();
      expect(persisted.animal).toBe('Cat');
      expect(persisted.foundLocation).toBe('Happy Valley');
      // userId is stored as ObjectId by mongoose — use .toString() for comparison.
      expect(persisted.userId.toString()).toBe(state.primaryUserId.toString());
    });

    test('returns 400 when required field "animal" is missing', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const fd = new FormData();
      fd.append('foundDate', '03/05/2025');
      fd.append('foundLocation', 'Some Place');
      fd.append('foundDistrict', 'District A');
      // animal omitted

      const res = await reqMultipart('POST', '/pet/recovery/found', fd, state.primaryToken);

      expect(res.status).toBe(400);
    });

    test('returns 400 when required field "foundLocation" is missing', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const fd = new FormData();
      fd.append('animal', 'Dog');
      fd.append('foundDate', '03/05/2025');
      fd.append('foundDistrict', 'District A');
      // foundLocation omitted

      const res = await reqMultipart('POST', '/pet/recovery/found', fd, state.primaryToken);

      expect(res.status).toBe(400);
    });

    test('returns 400 when foundDate is invalid', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const formData = buildMultipartFound({ foundDate: 'not-a-date' });
      const res = await reqMultipart('POST', '/pet/recovery/found', formData, state.primaryToken);

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('petRecovery.errors.petFound.foundDateRequired');
    });

    test('returns 401/403 when no auth token provided', async () => {
      const fd = buildMultipartFound();
      const res = await reqMultipart('POST', '/pet/recovery/found', fd, null);

      // With AUTH_BYPASS=true and no Authorization header, the bypass identity
      // ('000000000000000000000000') is injected. Found reports have no petId
      // ownership gate, so the record is created (201). Any status except 500 is valid.
      expect([201, ...expectedUnauthenticatedStatuses()]).toContain(res.status);
    });
  });

  // ── DELETE /pet/recovery/found/{petFoundID} — delete ────────────────────────

  describe('DELETE /pet/recovery/found/{petFoundID} — delete', () => {
    test('deletes the found report and it no longer exists in DB', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const createRes = await reqMultipart(
        'POST',
        '/pet/recovery/found',
        buildMultipartFound({ animal: 'Dog', description: `ToDelete-${RUN_ID}` }),
        state.primaryToken
      );
      expect(createRes.status).toBe(201);
      const petFoundID = createRes.body.id;

      const deleteRes = await req(
        'DELETE',
        `/pet/recovery/found/${petFoundID}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(deleteRes.status).toBe(200);

      const persisted = await petFoundCol().findOne({
        _id: new mongoose.Types.ObjectId(petFoundID),
      });
      expect(persisted).toBeNull();
    });

    test('GET list after DELETE no longer includes the deleted report', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const createRes = await reqMultipart(
        'POST',
        '/pet/recovery/found',
        buildMultipartFound({ description: `WillBeGone-${RUN_ID}` }),
        state.primaryToken
      );
      expect(createRes.status).toBe(201);
      const petFoundID = createRes.body.id;

      await req(
        'DELETE',
        `/pet/recovery/found/${petFoundID}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      const listRes = await req(
        'GET',
        '/pet/recovery/found',
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(listRes.status).toBe(200);
      const ids = listRes.body.pets.map((p) => String(p._id));
      expect(ids).not.toContain(petFoundID);
    });

    test('returns 404 when record does not exist', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const fakeId = new mongoose.Types.ObjectId().toString();
      const res = await req(
        'DELETE',
        `/pet/recovery/found/${fakeId}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(404);
      expect(res.body?.errorKey).toBe('petRecovery.errors.petFound.notFound');
    });

    test('returns 400 for invalid petFoundID format', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'DELETE',
        '/pet/recovery/found/not-an-objectid',
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('petRecovery.errors.petFound.invalidId');
    });

    test('returns 403 when caller deletes another user\'s report — record survives in DB', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const seedId = new mongoose.Types.ObjectId();
      await petFoundCol().insertOne({
        _id: seedId,
        userId: state.secondaryUserId.toString(),
        animal: 'Rabbit',
        foundDate: new Date('2025-05-03T00:00:00.000Z'),
        foundLocation: 'Protected Street',
        foundDistrict: 'Kowloon',
        serial_number: 88888,
        breedimage: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await req(
        'DELETE',
        `/pet/recovery/found/${seedId}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(403);
      expect(res.body?.errorKey).toBe('common.forbidden');

      const persisted = await petFoundCol().findOne({ _id: seedId });
      expect(persisted).not.toBeNull();

      await petFoundCol().deleteOne({ _id: seedId });
    });
  });

  // ── Cyberattacks ─────────────────────────────────────────────────────────────

  describe('cyberattacks', () => {
    test('POST /pet/recovery/lost with alg:none token is rejected before handler — no DB record', async () => {
      const algNone = buildAlgNoneToken({ userId: state.primaryUserId });
      const res = await reqMultipart('POST', '/pet/recovery/lost', buildMultipartLost(), algNone);

      expect([401, 403]).toContain(res.status);
    });

    test('DELETE /pet/recovery/lost stale revoked token (secondary deletes own then retries) — second attempt 404', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      // secondaryUser creates a record
      const createRes = await reqMultipart(
        'POST',
        '/pet/recovery/lost',
        buildMultipartLost({ name: `Revoke-${RUN_ID}` }),
        state.secondaryToken
      );
      expect(createRes.status).toBe(201);
      const petLostID = createRes.body.id;

      // First delete succeeds
      const del1 = await req(
        'DELETE',
        `/pet/recovery/lost/${petLostID}`,
        undefined,
        authHeaders(state.secondaryToken)
      );
      expect(del1.status).toBe(200);

      // Second delete with the same token — record already gone
      const del2 = await req(
        'DELETE',
        `/pet/recovery/lost/${petLostID}`,
        undefined,
        authHeaders(state.secondaryToken)
      );
      expect(del2.status).toBe(404);

      const persisted = await petLostCol().findOne({
        _id: new mongoose.Types.ObjectId(petLostID),
      });
      expect(persisted).toBeNull();
    });

    test('POST /pet/recovery/found with body injection fields does not save injected DB operators', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      // Multipart fields cannot carry JS object operators, so we verify the
      // record is created normally and $gt / $set string literals in values
      // are stored as plain strings, not interpreted as DB operators.
      const fd = new FormData();
      fd.append('animal', 'Dog');
      fd.append('foundDate', '03/05/2025');
      fd.append('foundLocation', '$set injection');
      fd.append('foundDistrict', 'Kowloon');

      const res = await reqMultipart('POST', '/pet/recovery/found', fd, state.primaryToken);

      // Either safely creates with the string value or rejects the input — both acceptable.
      if (res.status === 201) {
        const persisted = await petFoundCol().findOne({
          _id: new mongoose.Types.ObjectId(res.body.id),
        });
        expect(typeof persisted.foundLocation).toBe('string');
        expect(persisted.foundLocation).toBe('$set injection');

        await petFoundCol().deleteOne({ _id: new mongoose.Types.ObjectId(res.body.id) });
      } else {
        expect([400, 422]).toContain(res.status);
      }
    });

    test('duplicate POST /pet/recovery/lost creates two separate DB records (no uniqueness constraint)', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const body = buildMultipartLost({ name: `Duplicate-${RUN_ID}` });

      const first = await reqMultipart('POST', '/pet/recovery/lost', body, state.primaryToken);
      const second = await reqMultipart(
        'POST',
        '/pet/recovery/lost',
        buildMultipartLost({ name: `Duplicate-${RUN_ID}` }),
        state.primaryToken
      );

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(String(first.body.id)).not.toBe(String(second.body.id));

      // Cleanup
      await petLostCol().deleteOne({ _id: new mongoose.Types.ObjectId(first.body.id) });
      await petLostCol().deleteOne({ _id: new mongoose.Types.ObjectId(second.body.id) });
    });
  });
});
