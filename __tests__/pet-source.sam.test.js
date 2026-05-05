// Tier 3 — SAM local HTTP integration tests for the pet-source Lambda.
//
// Prerequisites (run before this suite):
//   sam local start-api \
//     --template .aws-sam/build/template.yaml \
//     --env-vars env.json \
//     --warm-containers EAGER
//
// The suite reads env.json for the MongoDB URI, JWT secret, and API key.
// Every DB-dependent test seeds its own fixtures and cleans up in afterAll.
// Tests that only exercise the authorizer / runtime boundary do not require a
// live DB.
//
// Coverage tiers (per dev_docs/llms/DDD_TESTING_STANDARD.md):
//   Tier 2 mock handler tests:    __tests__/pet-source.test.js
//   Tier 3 SAM + Mongo (this):    __tests__/pet-source.sam.test.js

const dns = require('dns');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const envConfig = require('../env.json');

const BASE_URL = process.env.PET_SOURCE_UAT_BASE_URL || 'http://127.0.0.1:3000';
const TEST_TS = Date.now();
const RUN_ID = `ddd-pet-source-${TEST_TS}`;
const JWT_SECRET =
  process.env.PET_SOURCE_TEST_JWT_SECRET ||
  envConfig.RequestAuthorizerFunction?.JWT_SECRET ||
  'PPCSecret';
const API_KEY =
  process.env.PET_SOURCE_TEST_API_KEY ||
  envConfig.Parameters?.ExistingApiKeyId ||
  'test-api-key';
const MONGODB_URI =
  envConfig.PetSourceFunction?.MONGODB_URI || envConfig.Parameters?.MONGODB_URI || '';
const ALLOWED_ORIGINS = envConfig.Parameters?.ALLOWED_ORIGINS || '*';
const AUTH_BYPASS =
  envConfig.Parameters?.AUTH_BYPASS || envConfig.PetSourceFunction?.AUTH_BYPASS || 'false';
const VALID_ORIGIN = 'http://localhost:3000';

let dbReady = false;
let dbConnectAttempted = false;
let dbConnectError = null;

const state = {
  primaryUserId: new mongoose.Types.ObjectId(),
  secondaryUserId: new mongoose.Types.ObjectId(),
  // Pet owned by primary, used for happy-path read/create/patch.
  primaryPetId: new mongoose.Types.ObjectId(),
  // Pet owned by secondary, used for forbidden-cross-owner cases.
  secondaryPetId: new mongoose.Types.ObjectId(),
  // Pet owned by primary that is soft-deleted, used for petNotFound cases.
  deletedPetId: new mongoose.Types.ObjectId(),
  // Pet owned by an NGO, used to prove the ngoId-based ownership branch.
  ngoPetId: new mongoose.Types.ObjectId(),
  ngoId: `ngo-pet-source-${TEST_TS}`,
  primaryToken: null,
  secondaryToken: null,
  ngoToken: null,
  // Source records seeded per-test as needed.
  createdSourceIds: [],
};

// ─── helpers ─────────────────────────────────────────────────────────────────

function signSourceToken({ userId, role = 'user', ngoId, expiresIn = '15m' }) {
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

// With AUTH_BYPASS=true the authorizer may pass through a missing/invalid token
// using a bypass identity, so the backend can return 401, 403, or 404.
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
  if (!MONGODB_URI) throw new Error('env.json missing PetSourceFunction.MONGODB_URI');
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

function sourcesCol() {
  return mongoose.connection.db.collection('pet_sources');
}

async function clearSourceFor(petId) {
  await sourcesCol().deleteMany({ petId });
}

async function seedFixtures() {
  state.primaryToken = signSourceToken({ userId: state.primaryUserId });
  state.secondaryToken = signSourceToken({ userId: state.secondaryUserId });
  state.ngoToken = signSourceToken({
    userId: state.primaryUserId,
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
  await sourcesCol().deleteMany({
    petId: {
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
      name: 'Mochi',
      animal: 'Dog',
      sex: 'Female',
      birthday: new Date('2024-01-01T00:00:00.000Z'),
      breedimage: [],
      deleted: false,
      createdAt: new Date(nowMs),
      updatedAt: new Date(nowMs),
    },
    {
      _id: state.secondaryPetId,
      userId: state.secondaryUserId,
      name: 'Buddy',
      animal: 'Cat',
      sex: 'Male',
      birthday: new Date('2023-06-01T00:00:00.000Z'),
      breedimage: [],
      deleted: false,
      createdAt: new Date(nowMs + 1),
      updatedAt: new Date(nowMs + 1),
    },
    {
      _id: state.deletedPetId,
      userId: state.primaryUserId,
      name: 'Ghost',
      animal: 'Dog',
      sex: 'Male',
      birthday: new Date('2022-01-01T00:00:00.000Z'),
      breedimage: [],
      deleted: true,
      createdAt: new Date(nowMs + 2),
      updatedAt: new Date(nowMs + 2),
    },
    {
      _id: state.ngoPetId,
      userId: null,
      ngoId: state.ngoId,
      name: 'NGO Pet',
      animal: 'Dog',
      sex: 'Female',
      birthday: new Date('2024-06-01T00:00:00.000Z'),
      breedimage: [],
      deleted: false,
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
    await fetch(`${BASE_URL}/pet/source/000000000000000000000000`, {
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
    await sourcesCol().deleteMany({
      petId: {
        $in: [
          state.primaryPetId,
          state.secondaryPetId,
          state.deletedPetId,
          state.ngoPetId,
        ],
      },
    });
    await sourcesCol().deleteMany({ _id: { $in: state.createdSourceIds } });
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

describe('Tier 3 - /pet/source via SAM local + UAT DB', () => {
  beforeAll(async () => {
    await ensureSamLocalReachable();
  });

  test('denied-origin preflight is not provable in this env because env.json uses ALLOWED_ORIGINS=*', () => {
    expect(ALLOWED_ORIGINS).toBe('*');
  });

  // ── Happy paths ─────────────────────────────────────────────────────────────

  describe('happy paths', () => {
    test('GET /pet/source/{petId} returns form=null when no source record exists yet', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearSourceFor(state.primaryPetId);

      const res = await req(
        'GET',
        `/pet/source/${state.primaryPetId}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(200);
      expect(res.body.form).toBeNull();
      expect(String(res.body.petId)).toBe(String(state.primaryPetId));
      expect(res.headers['access-control-allow-origin']).toBe('*');
    });

    test('POST /pet/source/{petId} creates a record and the document is persisted in DB', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearSourceFor(state.primaryPetId);

      const res = await req(
        'POST',
        `/pet/source/${state.primaryPetId}`,
        {
          placeofOrigin: 'Street rescue',
          channel: 'Volunteer',
          rescueCategory: ['injured'],
          causeOfInjury: 'Leg wound',
        },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(201);
      expect(res.body.sourceId).toBeDefined();

      const sourceOid = new mongoose.Types.ObjectId(res.body.sourceId);
      state.createdSourceIds.push(sourceOid);

      const persisted = await sourcesCol().findOne({ _id: sourceOid });
      expect(persisted).not.toBeNull();
      expect(String(persisted.petId)).toBe(String(state.primaryPetId));
      expect(persisted.placeofOrigin).toBe('Street rescue');
      expect(persisted.channel).toBe('Volunteer');
      expect(persisted.rescueCategory).toEqual(['injured']);
      expect(persisted.causeOfInjury).toBe('Leg wound');
    });

    test('GET after POST returns the persisted form and matching sourceId', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearSourceFor(state.primaryPetId);

      const createRes = await req(
        'POST',
        `/pet/source/${state.primaryPetId}`,
        { placeofOrigin: 'Shelter', channel: 'Referral' },
        authHeaders(state.primaryToken)
      );
      expect(createRes.status).toBe(201);
      state.createdSourceIds.push(new mongoose.Types.ObjectId(createRes.body.sourceId));

      const getRes = await req(
        'GET',
        `/pet/source/${state.primaryPetId}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(getRes.status).toBe(200);
      expect(getRes.body.form).not.toBeNull();
      expect(getRes.body.form.placeofOrigin).toBe('Shelter');
      expect(getRes.body.form.channel).toBe('Referral');
      expect(getRes.body.sourceId).toBe(createRes.body.sourceId);
    });

    test('PATCH /pet/source/{petId} updates only provided fields and DB reflects the change', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearSourceFor(state.primaryPetId);

      const createRes = await req(
        'POST',
        `/pet/source/${state.primaryPetId}`,
        { placeofOrigin: 'Original', channel: 'Original-Channel' },
        authHeaders(state.primaryToken)
      );
      expect(createRes.status).toBe(201);
      const sourceOid = new mongoose.Types.ObjectId(createRes.body.sourceId);
      state.createdSourceIds.push(sourceOid);

      const patchRes = await req(
        'PATCH',
        `/pet/source/${state.primaryPetId}`,
        { causeOfInjury: 'Recovered' },
        authHeaders(state.primaryToken)
      );

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.sourceId).toBe(createRes.body.sourceId);

      const persisted = await sourcesCol().findOne({ _id: sourceOid });
      expect(persisted.causeOfInjury).toBe('Recovered');
      expect(persisted.placeofOrigin).toBe('Original');
      expect(persisted.channel).toBe('Original-Channel');
    });

    test('repeated GET requests are stable across warm invocations', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearSourceFor(state.primaryPetId);

      const first = await req(
        'GET',
        `/pet/source/${state.primaryPetId}`,
        undefined,
        authHeaders(state.primaryToken)
      );
      const second = await req(
        'GET',
        `/pet/source/${state.primaryPetId}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(first.body.form).toBeNull();
      expect(second.body.form).toBeNull();
    });
  });

  // ── Input validation - 400 ──────────────────────────────────────────────────

  describe('input validation - 400', () => {
    test('GET /pet/source/{petId} rejects a non-ObjectId petId', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'GET',
        '/pet/source/not-a-valid-id',
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('petSource.errors.invalidPetId');
    });

    test('POST /pet/source/{petId} rejects malformed JSON body', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'POST',
        `/pet/source/${state.primaryPetId}`,
        '{"placeofOrigin"',
        authHeaders(state.primaryToken)
      );

      // The shared parseBody helper now normalises malformed JSON to
      // `common.invalidBodyParams` (the previous `common.invalidJSON` override
      // was removed from the pet-source service).
      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('common.invalidBodyParams');
    });

    test('POST /pet/source/{petId} rejects body missing both placeofOrigin and channel', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearSourceFor(state.primaryPetId);

      const res = await req(
        'POST',
        `/pet/source/${state.primaryPetId}`,
        { rescueCategory: ['injured'] },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('petSource.errors.missingRequiredFields');

      const persisted = await sourcesCol().findOne({ petId: state.primaryPetId });
      expect(persisted).toBeNull();
    });

    test('PATCH /pet/source/{petId} rejects an empty JSON body', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearSourceFor(state.primaryPetId);

      const createRes = await req(
        'POST',
        `/pet/source/${state.primaryPetId}`,
        { placeofOrigin: 'Seed' },
        authHeaders(state.primaryToken)
      );
      expect(createRes.status).toBe(201);
      state.createdSourceIds.push(new mongoose.Types.ObjectId(createRes.body.sourceId));

      const res = await req(
        'PATCH',
        `/pet/source/${state.primaryPetId}`,
        {},
        authHeaders(state.primaryToken)
      );

      // Empty body is rejected by parseBody's default requireNonEmpty: true using the
      // shared default `common.missingBodyParams` error key.
      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('common.missingBodyParams');
    });

    test('POST /pet/source/{petId} rejects unknown body fields with invalidBodyParams', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearSourceFor(state.primaryPetId);

      const res = await req(
        'POST',
        `/pet/source/${state.primaryPetId}`,
        { placeofOrigin: 'X', unknownField: 'noooo' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('common.invalidBodyParams');

      const persisted = await sourcesCol().findOne({ petId: state.primaryPetId });
      expect(persisted).toBeNull();
    });
  });

  // ── Business-logic errors - 4xx ─────────────────────────────────────────────

  describe('business-logic errors - 4xx', () => {
    test('POST /pet/source/{petId} returns 409 when a source already exists for the pet', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearSourceFor(state.primaryPetId);

      const first = await req(
        'POST',
        `/pet/source/${state.primaryPetId}`,
        { placeofOrigin: 'First' },
        authHeaders(state.primaryToken)
      );
      expect(first.status).toBe(201);
      state.createdSourceIds.push(new mongoose.Types.ObjectId(first.body.sourceId));

      const second = await req(
        'POST',
        `/pet/source/${state.primaryPetId}`,
        { placeofOrigin: 'Second' },
        authHeaders(state.primaryToken)
      );

      expect(second.status).toBe(409);
      expect(second.body.errorKey).toBe('petSource.errors.duplicateRecord');

      const count = await sourcesCol().countDocuments({ petId: state.primaryPetId });
      expect(count).toBe(1);
    });

    test('PATCH /pet/source/{petId} returns 404 when no source exists yet', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearSourceFor(state.primaryPetId);

      const res = await req(
        'PATCH',
        `/pet/source/${state.primaryPetId}`,
        { causeOfInjury: 'Update' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(404);
      expect(res.body.errorKey).toBe('petSource.errors.recordNotFound');
    });

    test('GET /pet/source/{petId} returns 404 when the pet is soft-deleted', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'GET',
        `/pet/source/${state.deletedPetId}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(404);
      expect(res.body.errorKey).toBe('petSource.errors.petNotFound');
    });

    test('GET /pet/source/{nonExistentPetId} returns 404', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const ghostPetId = new mongoose.Types.ObjectId();
      const res = await req(
        'GET',
        `/pet/source/${ghostPetId}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(404);
      expect(res.body.errorKey).toBe('petSource.errors.petNotFound');
    });
  });

  // ── Authentication and authorisation ────────────────────────────────────────

  describe('authentication and authorisation', () => {
    test('GET /pet/source/{petId} rejects a missing Authorization header', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req('GET', `/pet/source/${state.primaryPetId}`, undefined, {
        'x-api-key': API_KEY,
        origin: VALID_ORIGIN,
        'x-forwarded-for': '198.51.100.10',
      });

      expect(expectedUnauthenticatedStatuses()).toContain(res.status);
    });

    test('GET /pet/source/{petId} rejects a garbage bearer token', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'GET',
        `/pet/source/${state.primaryPetId}`,
        undefined,
        authHeaders('this.is.garbage')
      );

      expect([401, 403]).toContain(res.status);
    });

    test('GET /pet/source/{petId} rejects an expired JWT', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const expiredToken = signSourceToken({ userId: state.primaryUserId, expiresIn: -60 });
      const res = await req(
        'GET',
        `/pet/source/${state.primaryPetId}`,
        undefined,
        authHeaders(expiredToken)
      );

      expect([401, 403]).toContain(res.status);
    });

    test('GET /pet/source/{petId} rejects a tampered JWT', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const tampered = `${state.primaryToken.slice(0, -1)}${
        state.primaryToken.slice(-1) === 'a' ? 'b' : 'a'
      }`;
      const res = await req(
        'GET',
        `/pet/source/${state.primaryPetId}`,
        undefined,
        authHeaders(tampered)
      );

      expect([401, 403]).toContain(res.status);
    });

    test('GET /pet/source/{petId} rejects an alg:none JWT attack', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const algNone = buildAlgNoneToken({ userId: state.primaryUserId });
      const res = await req(
        'GET',
        `/pet/source/${state.primaryPetId}`,
        undefined,
        authHeaders(algNone)
      );

      expect([401, 403]).toContain(res.status);
    });

    test('GET /pet/source/{petId} returns 403 when caller reads another owner\'s pet', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'GET',
        `/pet/source/${state.secondaryPetId}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(403);
      expect(res.body.errorKey).toBe('common.forbidden');
    });

    test('POST /pet/source/{petId} returns 403 when caller writes to another owner\'s pet, with no DB mutation', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearSourceFor(state.secondaryPetId);

      const res = await req(
        'POST',
        `/pet/source/${state.secondaryPetId}`,
        { placeofOrigin: 'Hijack attempt' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(403);
      expect(res.body.errorKey).toBe('common.forbidden');

      const persisted = await sourcesCol().findOne({ petId: state.secondaryPetId });
      expect(persisted).toBeNull();
    });

    test('GET /pet/source/{petId} succeeds for an NGO-owned pet when the caller\'s token carries the matching ngoId', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearSourceFor(state.ngoPetId);

      const ngoSourceId = new mongoose.Types.ObjectId();
      await sourcesCol().insertOne({
        _id: ngoSourceId,
        petId: state.ngoPetId,
        placeofOrigin: 'NGO intake',
        channel: 'Shelter',
        rescueCategory: ['stray'],
        causeOfInjury: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      state.createdSourceIds.push(ngoSourceId);

      const okRes = await req(
        'GET',
        `/pet/source/${state.ngoPetId}`,
        undefined,
        authHeaders(state.ngoToken)
      );
      expect(okRes.status).toBe(200);
      expect(okRes.body.form.placeofOrigin).toBe('NGO intake');
      expect(okRes.body.sourceId).toBe(String(ngoSourceId));

      // A user without the matching ngoId on their token must be denied.
      const denyRes = await req(
        'GET',
        `/pet/source/${state.ngoPetId}`,
        undefined,
        authHeaders(state.primaryToken)
      );
      expect(denyRes.status).toBe(403);
      expect(denyRes.body.errorKey).toBe('common.forbidden');
    });

    test('PATCH /pet/source/{petId} returns 403 when caller patches another owner\'s pet', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearSourceFor(state.secondaryPetId);

      // Seed a source record under secondary owner via direct DB write so primary
      // cannot create one through the API.
      const secondarySourceId = new mongoose.Types.ObjectId();
      await sourcesCol().insertOne({
        _id: secondarySourceId,
        petId: state.secondaryPetId,
        placeofOrigin: 'Secondary owned',
        channel: null,
        rescueCategory: [],
        causeOfInjury: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      state.createdSourceIds.push(secondarySourceId);

      const res = await req(
        'PATCH',
        `/pet/source/${state.secondaryPetId}`,
        { placeofOrigin: 'Stolen update' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(403);
      expect(res.body.errorKey).toBe('common.forbidden');

      const persisted = await sourcesCol().findOne({ _id: secondarySourceId });
      expect(persisted.placeofOrigin).toBe('Secondary owned');
    });
  });

  // ── Cyberattacks ─────────────────────────────────────────────────────────────

  describe('cyberattacks', () => {
    test('PATCH /pet/source/{petId} rejects NoSQL operator injection in placeofOrigin and DB stays unchanged', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearSourceFor(state.primaryPetId);

      const createRes = await req(
        'POST',
        `/pet/source/${state.primaryPetId}`,
        { placeofOrigin: 'Untouched' },
        authHeaders(state.primaryToken)
      );
      expect(createRes.status).toBe(201);
      const sourceOid = new mongoose.Types.ObjectId(createRes.body.sourceId);
      state.createdSourceIds.push(sourceOid);

      const before = await sourcesCol().findOne({ _id: sourceOid });

      const res = await req(
        'PATCH',
        `/pet/source/${state.primaryPetId}`,
        { placeofOrigin: { $gt: '' } },
        authHeaders(state.primaryToken)
      );

      const after = await sourcesCol().findOne({ _id: sourceOid });

      expect(res.status).toBe(400);
      expect(after.placeofOrigin).toBe(before.placeofOrigin);
    });

    test('POST /pet/source/{petId} rejects mass-assignment of unknown fields and does not persist them', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearSourceFor(state.primaryPetId);

      const res = await req(
        'POST',
        `/pet/source/${state.primaryPetId}`,
        {
          placeofOrigin: 'Legit',
          deleted: true,
          petId: state.secondaryPetId.toString(),
          _id: new mongoose.Types.ObjectId().toString(),
        },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
      expect(res.body.errorKey).toBe('common.invalidBodyParams');

      const persisted = await sourcesCol().findOne({ petId: state.primaryPetId });
      expect(persisted).toBeNull();
    });

    test('PATCH /pet/source/{petId} rejects mass-assignment of unknown fields without mutating DB', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearSourceFor(state.primaryPetId);

      const createRes = await req(
        'POST',
        `/pet/source/${state.primaryPetId}`,
        { placeofOrigin: 'Original' },
        authHeaders(state.primaryToken)
      );
      expect(createRes.status).toBe(201);
      const sourceOid = new mongoose.Types.ObjectId(createRes.body.sourceId);
      state.createdSourceIds.push(sourceOid);

      const res = await req(
        'PATCH',
        `/pet/source/${state.primaryPetId}`,
        { placeofOrigin: 'Allowed', isAdmin: true, deleted: true },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
      expect(res.body.errorKey).toBe('common.invalidBodyParams');

      const persisted = await sourcesCol().findOne({ _id: sourceOid });
      expect(persisted.placeofOrigin).toBe('Original');
      expect(persisted.isAdmin).toBeUndefined();
      expect(persisted.deleted).toBeUndefined();
    });

    test('repeated hostile PATCH attempts are stable and do not corrupt DB state', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearSourceFor(state.primaryPetId);

      const createRes = await req(
        'POST',
        `/pet/source/${state.primaryPetId}`,
        { placeofOrigin: 'Original' },
        authHeaders(state.primaryToken)
      );
      expect(createRes.status).toBe(201);
      const sourceOid = new mongoose.Types.ObjectId(createRes.body.sourceId);
      state.createdSourceIds.push(sourceOid);

      const first = await req(
        'PATCH',
        `/pet/source/${state.primaryPetId}`,
        { isAdmin: true },
        authHeaders(state.primaryToken)
      );
      const second = await req(
        'PATCH',
        `/pet/source/${state.primaryPetId}`,
        { isAdmin: true },
        authHeaders(state.primaryToken)
      );

      expect(first.status).toBe(400);
      expect(second.status).toBe(400);

      const persisted = await sourcesCol().findOne({ _id: sourceOid });
      expect(persisted.placeofOrigin).toBe('Original');
      expect(persisted.isAdmin).toBeUndefined();
    });

    test('replayed duplicate POST is rejected with 409 and only one record persists', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearSourceFor(state.primaryPetId);

      const body = { placeofOrigin: 'Replay' };
      const first = await req(
        'POST',
        `/pet/source/${state.primaryPetId}`,
        body,
        authHeaders(state.primaryToken)
      );
      expect(first.status).toBe(201);
      state.createdSourceIds.push(new mongoose.Types.ObjectId(first.body.sourceId));

      const replay = await req(
        'POST',
        `/pet/source/${state.primaryPetId}`,
        body,
        authHeaders(state.primaryToken)
      );
      expect(replay.status).toBe(409);

      const count = await sourcesCol().countDocuments({ petId: state.primaryPetId });
      expect(count).toBe(1);
    });
  });

  // ── Runtime boundary behavior ────────────────────────────────────────────────

  describe('runtime boundary behavior', () => {
    test('OPTIONS /pet/source/{petId} returns 204 with CORS headers', async () => {
      const res = await req(
        'OPTIONS',
        `/pet/source/${state.primaryPetId}`,
        undefined,
        { origin: VALID_ORIGIN }
      );

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.headers['access-control-allow-headers']).toContain('x-api-key');
    });

    test('PUT /pet/source/{petId} returns 405 method-not-allowed (or 403 from gateway)', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'PUT',
        `/pet/source/${state.primaryPetId}`,
        { placeofOrigin: 'wrong method' },
        authHeaders(state.primaryToken)
      );

      // SAM/local API Gateway may intercept unrecognised methods before the
      // Lambda router. Both 403 (gateway) and 405 (router) are correct rejections.
      // The Lambda router's 405 is proven directly at Tier 2.
      expect([403, 405]).toContain(res.status);
    });

    test('GET /pet/source/extra/path is rejected by the gateway before reaching the Lambda', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'GET',
        '/pet/source/extra/unknown/path',
        undefined,
        authHeaders(state.primaryToken)
      );

      // API Gateway intercepts unknown paths before forwarding to the Lambda,
      // so the response is 403 from the gateway rather than the router's 404.
      // The Lambda router's 404 is proven directly at Tier 2.
      expect([403, 404]).toContain(res.status);
    });
  });

  // ── Still deferred ───────────────────────────────────────────────────────────
  // The following items require infrastructure not covered by SAM local HTTP tests.

  describe('deferred — requires live AWS or unavailable infra', () => {
    test.todo('parallel duplicate POST requests honor the unique petId index under concurrency (requires load harness)');
    test.todo('deployed AWS verification: API Gateway authorizer deny prevents this Lambda from running');
    test.todo('deployed AWS verification: requestContext.authorizer is injected correctly by live API Gateway');
  });
});
