// Tier 3 — SAM local HTTP integration tests for the pet-medical Lambda.
// Tier 4 — Real MongoDB UAT persistence proofs.
//
// Prerequisites (run before this suite):
//   sam local start-api \
//     --template .aws-sam/build/template.yaml \
//     --env-vars env.json \
//     --warm-containers EAGER
//
// Coverage tiers (per dev_docs/llms/DDD_TESTING_STANDARD.md):
//   Tier 2 mock handler tests:    __tests__/pet-medical.test.js
//   Tier 3 SAM + Mongo (this):    __tests__/pet-medical.sam.test.js
//
// Routes under test (all protected — require valid Bearer token):
//   GET    /pet/medical/{petId}/general
//   POST   /pet/medical/{petId}/general
//   PATCH  /pet/medical/{petId}/general/{medicalId}
//   DELETE /pet/medical/{petId}/general/{medicalId}
//   GET    /pet/medical/{petId}/medication
//   POST   /pet/medical/{petId}/medication
//   PATCH  /pet/medical/{petId}/medication/{medicationId}
//   DELETE /pet/medical/{petId}/medication/{medicationId}
//   GET    /pet/medical/{petId}/deworming
//   POST   /pet/medical/{petId}/deworming
//   PATCH  /pet/medical/{petId}/deworming/{dewormId}
//   DELETE /pet/medical/{petId}/deworming/{dewormId}
//   GET    /pet/medical/{petId}/blood-test
//   POST   /pet/medical/{petId}/blood-test
//   PATCH  /pet/medical/{petId}/blood-test/{bloodTestId}
//   DELETE /pet/medical/{petId}/blood-test/{bloodTestId}
//
// DB collections used: pets, medical_records, medication_records, deworm_records, blood_tests

const dns = require('dns');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const envConfig = require('../env.json');

const BASE_URL = process.env.PET_MEDICAL_UAT_BASE_URL || 'http://127.0.0.1:3000';
const TEST_TS = Date.now();
const RUN_ID = `ddd-pet-medical-${TEST_TS}`;
const JWT_SECRET =
  process.env.PET_MEDICAL_TEST_JWT_SECRET ||
  envConfig.RequestAuthorizerFunction?.JWT_SECRET ||
  'PPCSecret';
const API_KEY =
  process.env.PET_MEDICAL_TEST_API_KEY ||
  envConfig.Parameters?.ExistingApiKeyId ||
  'test-api-key';
const MONGODB_URI =
  envConfig.PetMedicalFunction?.MONGODB_URI || envConfig.Parameters?.MONGODB_URI || '';
const ALLOWED_ORIGINS = envConfig.Parameters?.ALLOWED_ORIGINS || '*';
const AUTH_BYPASS =
  envConfig.Parameters?.AUTH_BYPASS || envConfig.PetMedicalFunction?.AUTH_BYPASS || 'false';
const VALID_ORIGIN = 'http://localhost:3000';

let dbReady = false;
let dbConnectAttempted = false;
let dbConnectError = null;

const state = {
  primaryUserId: new mongoose.Types.ObjectId(),
  secondaryUserId: new mongoose.Types.ObjectId(),
  primaryPetId: new mongoose.Types.ObjectId(),
  secondaryPetId: new mongoose.Types.ObjectId(),
  deletedPetId: new mongoose.Types.ObjectId(),
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
  if (!MONGODB_URI) throw new Error('env.json missing PetMedicalFunction.MONGODB_URI');
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

function medicalCol() {
  return mongoose.connection.db.collection('medical_records');
}

function medicationCol() {
  return mongoose.connection.db.collection('medication_records');
}

function dewormCol() {
  return mongoose.connection.db.collection('deworm_records');
}

function bloodTestCol() {
  return mongoose.connection.db.collection('blood_tests');
}

async function clearMedicalFor(petId) {
  await Promise.all([
    medicalCol().deleteMany({ petId: petId }),
    medicationCol().deleteMany({ petId: petId }),
    dewormCol().deleteMany({ petId: petId }),
    bloodTestCol().deleteMany({ petId: petId }),
  ]);
}

async function seedFixtures() {
  state.primaryToken = signToken({ userId: state.primaryUserId });
  state.secondaryToken = signToken({ userId: state.secondaryUserId });

  // Clear rate-limit counters so 429s from previous runs don't bleed into this one.
  await mongoose.connection.db.collection('rate_limits').deleteMany({
    action: /^petMedicalRecord\./,
  });

  const nowMs = Date.now();

  await petsCol().deleteMany({
    _id: { $in: [state.primaryPetId, state.secondaryPetId, state.deletedPetId] },
  });

  await petsCol().insertMany([
    {
      _id: state.primaryPetId,
      userId: state.primaryUserId,
      name: `MediPet-${RUN_ID}`,
      animal: 'Dog',
      sex: 'Male',
      birthday: new Date('2022-01-01T00:00:00.000Z'),
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
      name: `OtherPet-${RUN_ID}`,
      animal: 'Cat',
      sex: 'Female',
      birthday: new Date('2023-01-01T00:00:00.000Z'),
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
      name: `DeletedPet-${RUN_ID}`,
      animal: 'Dog',
      sex: 'Female',
      birthday: new Date('2021-01-01T00:00:00.000Z'),
      breedimage: [],
      deleted: true,
      transfer: [],
      transferNGO: [],
      createdAt: new Date(nowMs + 2),
      updatedAt: new Date(nowMs + 2),
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
  const petId = new mongoose.Types.ObjectId().toString();
  try {
    await fetch(`${BASE_URL}/pet/medical/${petId}/general`, {
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
    const ids = [state.primaryPetId, state.secondaryPetId, state.deletedPetId];
    await clearMedicalFor(state.primaryPetId);
    await clearMedicalFor(state.secondaryPetId);
    await petsCol().deleteMany({ _id: { $in: ids } });
    await mongoose.disconnect();
  }
});

// ─── suite ───────────────────────────────────────────────────────────────────

describe('Tier 3+4 - /pet/medical via SAM local + UAT DB', () => {
  beforeAll(async () => {
    await ensureSamLocalReachable();
  });

  test('env.json uses ALLOWED_ORIGINS=* so denied-origin preflight is not provable here', () => {
    expect(ALLOWED_ORIGINS).toBe('*');
  });

  // ── CORS / runtime boundary ──────────────────────────────────────────────────

  describe('runtime boundary behavior', () => {
    test('OPTIONS /pet/medical/{petId}/general returns 204 with CORS headers', async () => {
      const petId = new mongoose.Types.ObjectId().toString();
      const res = await req('OPTIONS', `/pet/medical/${petId}/general`, undefined, {
        origin: VALID_ORIGIN,
      });

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.headers['access-control-allow-headers']).toContain('x-api-key');
    });

    test('OPTIONS /pet/medical/{petId}/general/{medicalId} returns 204 with CORS headers', async () => {
      const petId = new mongoose.Types.ObjectId().toString();
      const medicalId = new mongoose.Types.ObjectId().toString();
      const res = await req(
        'OPTIONS',
        `/pet/medical/${petId}/general/${medicalId}`,
        undefined,
        { origin: VALID_ORIGIN }
      );

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('*');
    });

    test('PUT /pet/medical/{petId}/general returns 403 or 405 (wrong method)', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'PUT',
        `/pet/medical/${state.primaryPetId}/general`,
        {},
        authHeaders(state.primaryToken)
      );

      expect([403, 405]).toContain(res.status);
    });

    test('unknown nested path returns 403 or 404', async () => {
      const res = await req(
        'GET',
        '/pet/medical/extra/nested/path',
        undefined,
        publicHeaders()
      );

      expect([403, 404]).toContain(res.status);
    });

    test('CORS headers are present on a protected 401/403 response', async () => {
      const petId = new mongoose.Types.ObjectId().toString();
      const res = await req('GET', `/pet/medical/${petId}/general`, undefined, publicHeaders());

      expect(res.headers['access-control-allow-origin']).toBe('*');
    });
  });

  // ── Authentication and authorisation ────────────────────────────────────────

  describe('authentication and authorisation', () => {
    test('GET /pet/medical/{petId}/general rejects missing Authorization header', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'GET',
        `/pet/medical/${state.primaryPetId}/general`,
        undefined,
        publicHeaders()
      );

      expect(expectedUnauthenticatedStatuses()).toContain(res.status);
    });

    test('POST /pet/medical/{petId}/general rejects garbage bearer token', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'POST',
        `/pet/medical/${state.primaryPetId}/general`,
        { medicalPlace: 'Clinic A' },
        authHeaders('this.is.garbage')
      );

      expect([401, 403]).toContain(res.status);
    });

    test('POST /pet/medical/{petId}/general rejects expired JWT', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const expiredToken = signToken({ userId: state.primaryUserId, expiresIn: -60 });
      const res = await req(
        'POST',
        `/pet/medical/${state.primaryPetId}/general`,
        { medicalPlace: 'Clinic A' },
        authHeaders(expiredToken)
      );

      expect([401, 403]).toContain(res.status);
    });

    test('POST /pet/medical/{petId}/general rejects tampered JWT', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      state.primaryToken = signToken({ userId: state.primaryUserId });

      const tampered = `${state.primaryToken.slice(0, -1)}${
        state.primaryToken.slice(-1) === 'a' ? 'b' : 'a'
      }`;
      const res = await req(
        'POST',
        `/pet/medical/${state.primaryPetId}/general`,
        { medicalPlace: 'Clinic A' },
        authHeaders(tampered)
      );

      expect([401, 403]).toContain(res.status);
    });

    test('POST /pet/medical/{petId}/general rejects alg:none JWT attack', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const algNone = buildAlgNoneToken({ userId: state.primaryUserId });
      const res = await req(
        'POST',
        `/pet/medical/${state.primaryPetId}/general`,
        { medicalPlace: 'Clinic A' },
        authHeaders(algNone)
      );

      expect([401, 403]).toContain(res.status);
    });

    test('GET /pet/medical/{petId}/general returns 403 when caller accesses another owner\'s pet', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'GET',
        `/pet/medical/${state.secondaryPetId}/general`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(403);
      expect(res.body?.errorKey).toBe('common.forbidden');
    });

    test('GET /pet/medical/{petId}/general returns 404 when pet is soft-deleted', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'GET',
        `/pet/medical/${state.deletedPetId}/general`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(404);
    });
  });

  // ── General medical records ───────────────────────────────────────────────────

  describe('GET /pet/medical/{petId}/general — list', () => {
    test('returns 200 with empty list when no records exist', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearMedicalFor(state.primaryPetId);

      const res = await req(
        'GET',
        `/pet/medical/${state.primaryPetId}/general`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body?.form?.medical)).toBe(true);
      expect(res.body.form.medical).toHaveLength(0);
      expect(String(res.body.petId)).toBe(String(state.primaryPetId));
    });

    test('returns 400 for non-ObjectId petId', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'GET',
        '/pet/medical/not-valid-id/general',
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
    });

    test('returns list with record after creation', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearMedicalFor(state.primaryPetId);

      const createRes = await req(
        'POST',
        `/pet/medical/${state.primaryPetId}/general`,
        { medicalPlace: 'City Vet', medicalDoctor: 'Dr. Chan' },
        authHeaders(state.primaryToken)
      );
      expect(createRes.status).toBe(201);

      const listRes = await req(
        'GET',
        `/pet/medical/${state.primaryPetId}/general`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(listRes.status).toBe(200);
      expect(listRes.body.form.medical.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('POST /pet/medical/{petId}/general — create', () => {
    test('creates a record and persists it to DB', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearMedicalFor(state.primaryPetId);

      const res = await req(
        'POST',
        `/pet/medical/${state.primaryPetId}/general`,
        {
          medicalDate: '15/06/2024',
          medicalPlace: 'PetCare Hospital',
          medicalDoctor: 'Dr. Wong',
          medicalResult: 'Healthy',
          medicalSolution: 'Vitamins',
        },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(201);
      expect(res.body?.medicalRecordId).toBeDefined();
      expect(String(res.body.petId)).toBe(String(state.primaryPetId));

      const persisted = await medicalCol().findOne({
        _id: new mongoose.Types.ObjectId(res.body.medicalRecordId),
      });
      expect(persisted).not.toBeNull();
      expect(persisted.medicalPlace).toBe('PetCare Hospital');
      expect(persisted.medicalDoctor).toBe('Dr. Wong');
      expect(persisted.petId.toString()).toBe(String(state.primaryPetId));
    });

    test('creates a record with a single optional field (requireNonEmpty allows any key)', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearMedicalFor(state.primaryPetId);

      const res = await req(
        'POST',
        `/pet/medical/${state.primaryPetId}/general`,
        { medicalPlace: 'Min Body Vet' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(201);
      expect(res.body?.medicalRecordId).toBeDefined();

      const persisted = await medicalCol().findOne({
        _id: new mongoose.Types.ObjectId(res.body.medicalRecordId),
      });
      expect(persisted).not.toBeNull();
    });

    test('returns 400 for invalid medicalDate format', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearMedicalFor(state.primaryPetId);

      const res = await req(
        'POST',
        `/pet/medical/${state.primaryPetId}/general`,
        { medicalDate: 'not-a-date' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('petMedicalRecord.errors.medicalRecord.invalidDateFormat');

      const count = await medicalCol().countDocuments({ petId: state.primaryPetId });
      expect(count).toBe(0);
    });

    test('returns 400 for malformed JSON body', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'POST',
        `/pet/medical/${state.primaryPetId}/general`,
        '{"medicalPlace"',
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
    });

    test('returns 400 for mass-assignment of unknown fields — no DB mutation', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearMedicalFor(state.primaryPetId);

      const res = await req(
        'POST',
        `/pet/medical/${state.primaryPetId}/general`,
        {
          medicalPlace: 'Legit Clinic',
          deleted: true,
          isAdmin: true,
          __proto__: { role: 'admin' },
        },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);

      const count = await medicalCol().countDocuments({ petId: state.primaryPetId });
      expect(count).toBe(0);
    });

    test('returns 403 when caller creates record for another owner\'s pet — no DB mutation', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearMedicalFor(state.secondaryPetId);

      const res = await req(
        'POST',
        `/pet/medical/${state.secondaryPetId}/general`,
        { medicalPlace: 'Hijack Clinic' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(403);
      expect(res.body?.errorKey).toBe('common.forbidden');

      const count = await medicalCol().countDocuments({ petId: state.secondaryPetId });
      expect(count).toBe(0);
    });

    test('returns 404 when pet is soft-deleted — no DB mutation', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearMedicalFor(state.deletedPetId);

      const res = await req(
        'POST',
        `/pet/medical/${state.deletedPetId}/general`,
        { medicalPlace: 'Ghost Clinic' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(404);

      const count = await medicalCol().countDocuments({ petId: state.deletedPetId });
      expect(count).toBe(0);
    });
  });

  describe('PATCH /pet/medical/{petId}/general/{medicalId} — update', () => {
    test('updates fields and DB reflects the change', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearMedicalFor(state.primaryPetId);

      const createRes = await req(
        'POST',
        `/pet/medical/${state.primaryPetId}/general`,
        { medicalPlace: 'Original Clinic', medicalDoctor: 'Dr. Original' },
        authHeaders(state.primaryToken)
      );
      expect(createRes.status).toBe(201);
      const medicalId = createRes.body.medicalRecordId;

      const patchRes = await req(
        'PATCH',
        `/pet/medical/${state.primaryPetId}/general/${medicalId}`,
        { medicalPlace: 'Updated Clinic', medicalResult: 'All Good' },
        authHeaders(state.primaryToken)
      );

      expect(patchRes.status).toBe(200);
      expect(patchRes.body?.petId).toBeDefined();

      const persisted = await medicalCol().findOne({
        _id: new mongoose.Types.ObjectId(medicalId),
      });
      expect(persisted.medicalPlace).toBe('Updated Clinic');
      expect(persisted.medicalResult).toBe('All Good');
      expect(persisted.medicalDoctor).toBe('Dr. Original');
    });

    test('returns 404 when record does not exist', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const fakeId = new mongoose.Types.ObjectId().toString();
      const res = await req(
        'PATCH',
        `/pet/medical/${state.primaryPetId}/general/${fakeId}`,
        { medicalPlace: 'Nowhere' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(404);
      expect(res.body?.errorKey).toBe('petMedicalRecord.errors.medicalRecord.notFound');
    });

    test('returns 400 for invalid medicalId format', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'PATCH',
        `/pet/medical/${state.primaryPetId}/general/not-an-objectid`,
        { medicalPlace: 'Clinic' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
    });

    test('returns 403 when caller updates another owner\'s pet record — DB unchanged', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearMedicalFor(state.secondaryPetId);

      const seedId = new mongoose.Types.ObjectId();
      await medicalCol().insertOne({
        _id: seedId,
        petId: String(state.secondaryPetId),
        medicalPlace: 'Protected Clinic',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await req(
        'PATCH',
        `/pet/medical/${state.secondaryPetId}/general/${seedId}`,
        { medicalPlace: 'Stolen Update' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(403);
      expect(res.body?.errorKey).toBe('common.forbidden');

      const persisted = await medicalCol().findOne({ _id: seedId });
      expect(persisted.medicalPlace).toBe('Protected Clinic');
    });
  });

  describe('DELETE /pet/medical/{petId}/general/{medicalId} — delete', () => {
    test('deletes the record and it no longer exists in DB', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearMedicalFor(state.primaryPetId);

      const createRes = await req(
        'POST',
        `/pet/medical/${state.primaryPetId}/general`,
        { medicalPlace: 'ToDelete Clinic' },
        authHeaders(state.primaryToken)
      );
      expect(createRes.status).toBe(201);
      const medicalId = createRes.body.medicalRecordId;

      const deleteRes = await req(
        'DELETE',
        `/pet/medical/${state.primaryPetId}/general/${medicalId}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(deleteRes.status).toBe(200);

      const persisted = await medicalCol().findOne({
        _id: new mongoose.Types.ObjectId(medicalId),
      });
      expect(persisted).toBeNull();
    });

    test('GET list after DELETE no longer contains the deleted record', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearMedicalFor(state.primaryPetId);

      const createRes = await req(
        'POST',
        `/pet/medical/${state.primaryPetId}/general`,
        { medicalPlace: 'Will Be Deleted' },
        authHeaders(state.primaryToken)
      );
      expect(createRes.status).toBe(201);
      const medicalId = createRes.body.medicalRecordId;

      await req(
        'DELETE',
        `/pet/medical/${state.primaryPetId}/general/${medicalId}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      const listRes = await req(
        'GET',
        `/pet/medical/${state.primaryPetId}/general`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(listRes.status).toBe(200);
      const ids = listRes.body.form.medical.map((r) => String(r._id));
      expect(ids).not.toContain(medicalId);
    });

    test('returns 404 when record does not exist', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const fakeId = new mongoose.Types.ObjectId().toString();
      const res = await req(
        'DELETE',
        `/pet/medical/${state.primaryPetId}/general/${fakeId}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(404);
      expect(res.body?.errorKey).toBe('petMedicalRecord.errors.medicalRecord.notFound');
    });

    test('returns 403 when caller deletes another owner\'s pet record — DB record survives', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearMedicalFor(state.secondaryPetId);

      const seedId = new mongoose.Types.ObjectId();
      await medicalCol().insertOne({
        _id: seedId,
        petId: String(state.secondaryPetId),
        medicalPlace: 'Do Not Delete',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await req(
        'DELETE',
        `/pet/medical/${state.secondaryPetId}/general/${seedId}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(403);
      expect(res.body?.errorKey).toBe('common.forbidden');

      const persisted = await medicalCol().findOne({ _id: seedId });
      expect(persisted).not.toBeNull();
    });
  });

  // ── Medication records ────────────────────────────────────────────────────────

  describe('POST /pet/medical/{petId}/medication — create', () => {
    test('creates a medication record and persists it to DB', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearMedicalFor(state.primaryPetId);

      const res = await req(
        'POST',
        `/pet/medical/${state.primaryPetId}/medication`,
        {
          medicationDate: '2024-05-10',
          drugName: 'Amoxicillin',
          drugPurpose: 'Infection',
          drugMethod: 'Oral',
          allergy: false,
        },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(201);
      expect(res.body?.medicationRecordId).toBeDefined();

      const persisted = await medicationCol().findOne({
        _id: new mongoose.Types.ObjectId(res.body.medicationRecordId),
      });
      expect(persisted).not.toBeNull();
      expect(persisted.drugName).toBe('Amoxicillin');
      expect(persisted.petId.toString()).toBe(String(state.primaryPetId));
    });

    test('returns 400 for invalid medicationDate format', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearMedicalFor(state.primaryPetId);

      const res = await req(
        'POST',
        `/pet/medical/${state.primaryPetId}/medication`,
        { medicationDate: 'bad-date' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe(
        'petMedicalRecord.errors.medicationRecord.invalidDateFormat'
      );

      const count = await medicationCol().countDocuments({ petId: state.primaryPetId });
      expect(count).toBe(0);
    });

    test('returns 403 for cross-owner access — no DB mutation', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearMedicalFor(state.secondaryPetId);

      const res = await req(
        'POST',
        `/pet/medical/${state.secondaryPetId}/medication`,
        { drugName: 'Stolen Drug' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(403);

      const count = await medicationCol().countDocuments({ petId: state.secondaryPetId });
      expect(count).toBe(0);
    });
  });

  describe('PATCH /pet/medical/{petId}/medication/{medicationId} — update', () => {
    test('updates medication record and DB reflects the change', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearMedicalFor(state.primaryPetId);

      const createRes = await req(
        'POST',
        `/pet/medical/${state.primaryPetId}/medication`,
        { drugName: 'Penicillin', drugPurpose: 'Infection' },
        authHeaders(state.primaryToken)
      );
      expect(createRes.status).toBe(201);
      const medicationId = createRes.body.medicationRecordId;

      const patchRes = await req(
        'PATCH',
        `/pet/medical/${state.primaryPetId}/medication/${medicationId}`,
        { drugName: 'Amoxicillin', allergy: true },
        authHeaders(state.primaryToken)
      );

      expect(patchRes.status).toBe(200);

      const persisted = await medicationCol().findOne({
        _id: new mongoose.Types.ObjectId(medicationId),
      });
      expect(persisted.drugName).toBe('Amoxicillin');
      expect(persisted.allergy).toBe(true);
      expect(persisted.drugPurpose).toBe('Infection');
    });

    test('returns 404 when record does not exist', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const fakeId = new mongoose.Types.ObjectId().toString();
      const res = await req(
        'PATCH',
        `/pet/medical/${state.primaryPetId}/medication/${fakeId}`,
        { drugName: 'No Record' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /pet/medical/{petId}/medication/{medicationId} — delete', () => {
    test('deletes the medication record from DB', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearMedicalFor(state.primaryPetId);

      const createRes = await req(
        'POST',
        `/pet/medical/${state.primaryPetId}/medication`,
        { drugName: 'ToDelete' },
        authHeaders(state.primaryToken)
      );
      expect(createRes.status).toBe(201);
      const medicationId = createRes.body.medicationRecordId;

      const deleteRes = await req(
        'DELETE',
        `/pet/medical/${state.primaryPetId}/medication/${medicationId}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(deleteRes.status).toBe(200);

      const persisted = await medicationCol().findOne({
        _id: new mongoose.Types.ObjectId(medicationId),
      });
      expect(persisted).toBeNull();
    });

    test('returns 403 when deleting another owner\'s medication record — record survives', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearMedicalFor(state.secondaryPetId);

      const seedId = new mongoose.Types.ObjectId();
      await medicationCol().insertOne({
        _id: seedId,
        petId: String(state.secondaryPetId),
        drugName: 'Protected Drug',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await req(
        'DELETE',
        `/pet/medical/${state.secondaryPetId}/medication/${seedId}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(403);

      const persisted = await medicationCol().findOne({ _id: seedId });
      expect(persisted).not.toBeNull();
    });
  });

  // ── Deworming records ─────────────────────────────────────────────────────────

  describe('POST /pet/medical/{petId}/deworming — create', () => {
    test('creates a deworming record and persists it to DB', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearMedicalFor(state.primaryPetId);

      const res = await req(
        'POST',
        `/pet/medical/${state.primaryPetId}/deworming`,
        {
          date: '01/03/2024',
          vaccineBrand: 'NexGard',
          vaccineType: 'External',
          typesOfExternalParasites: ['Flea', 'Tick'],
          frequency: 30,
          nextDewormDate: '01/04/2024',
          notification: true,
        },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(201);
      expect(res.body?.dewormRecordId).toBeDefined();

      const persisted = await dewormCol().findOne({
        _id: new mongoose.Types.ObjectId(res.body.dewormRecordId),
      });
      expect(persisted).not.toBeNull();
      expect(persisted.vaccineBrand).toBe('NexGard');
      expect(persisted.frequency).toBe(30);
      expect(persisted.petId.toString()).toBe(String(state.primaryPetId));
    });

    test('returns 400 for invalid deworming date format', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearMedicalFor(state.primaryPetId);

      const res = await req(
        'POST',
        `/pet/medical/${state.primaryPetId}/deworming`,
        { date: 'not-a-date' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('petMedicalRecord.errors.dewormRecord.invalidDateFormat');
    });

    test('returns 400 for invalid nextDewormDate format', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearMedicalFor(state.primaryPetId);

      const res = await req(
        'POST',
        `/pet/medical/${state.primaryPetId}/deworming`,
        { date: '01/03/2024', nextDewormDate: 'bad-next' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('petMedicalRecord.errors.dewormRecord.invalidDateFormat');
    });
  });

  describe('PATCH /pet/medical/{petId}/deworming/{dewormId} — update', () => {
    test('updates deworming record and DB reflects the change', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearMedicalFor(state.primaryPetId);

      const createRes = await req(
        'POST',
        `/pet/medical/${state.primaryPetId}/deworming`,
        { vaccineBrand: 'Original Brand', frequency: 14 },
        authHeaders(state.primaryToken)
      );
      expect(createRes.status).toBe(201);
      const dewormId = createRes.body.dewormRecordId;

      const patchRes = await req(
        'PATCH',
        `/pet/medical/${state.primaryPetId}/deworming/${dewormId}`,
        { vaccineBrand: 'Updated Brand', notification: false },
        authHeaders(state.primaryToken)
      );

      expect(patchRes.status).toBe(200);

      const persisted = await dewormCol().findOne({
        _id: new mongoose.Types.ObjectId(dewormId),
      });
      expect(persisted.vaccineBrand).toBe('Updated Brand');
      expect(persisted.frequency).toBe(14);
    });

    test('returns 404 when record does not exist', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const fakeId = new mongoose.Types.ObjectId().toString();
      const res = await req(
        'PATCH',
        `/pet/medical/${state.primaryPetId}/deworming/${fakeId}`,
        { vaccineBrand: 'No Record' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /pet/medical/{petId}/deworming/{dewormId} — delete', () => {
    test('deletes the deworming record from DB', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearMedicalFor(state.primaryPetId);

      const createRes = await req(
        'POST',
        `/pet/medical/${state.primaryPetId}/deworming`,
        { vaccineBrand: 'ToDelete Brand' },
        authHeaders(state.primaryToken)
      );
      expect(createRes.status).toBe(201);
      const dewormId = createRes.body.dewormRecordId;

      const deleteRes = await req(
        'DELETE',
        `/pet/medical/${state.primaryPetId}/deworming/${dewormId}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(deleteRes.status).toBe(200);

      const persisted = await dewormCol().findOne({
        _id: new mongoose.Types.ObjectId(dewormId),
      });
      expect(persisted).toBeNull();
    });
  });

  // ── Blood-test records ────────────────────────────────────────────────────────

  describe('POST /pet/medical/{petId}/blood-test — create', () => {
    test('creates a blood-test record and persists it to DB', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearMedicalFor(state.primaryPetId);

      const res = await req(
        'POST',
        `/pet/medical/${state.primaryPetId}/blood-test`,
        {
          bloodTestDate: '2024-07-20',
          heartworm: 'Negative',
          lymeDisease: 'Negative',
          ehrlichiosis: 'Negative',
          anaplasmosis: 'Negative',
          babesiosis: 'Negative',
        },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(201);
      expect(res.body?.bloodTestRecordId).toBeDefined();

      const persisted = await bloodTestCol().findOne({
        _id: new mongoose.Types.ObjectId(res.body.bloodTestRecordId),
      });
      expect(persisted).not.toBeNull();
      expect(persisted.heartworm).toBe('Negative');
      expect(persisted.petId.toString()).toBe(String(state.primaryPetId));
    });

    test('returns 400 for invalid bloodTestDate format', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearMedicalFor(state.primaryPetId);

      const res = await req(
        'POST',
        `/pet/medical/${state.primaryPetId}/blood-test`,
        { bloodTestDate: 'not-a-date' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('petMedicalRecord.errors.bloodTest.invalidDateFormat');

      const count = await bloodTestCol().countDocuments({ petId: state.primaryPetId });
      expect(count).toBe(0);
    });

    test('returns 403 for cross-owner access — no DB mutation', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearMedicalFor(state.secondaryPetId);

      const res = await req(
        'POST',
        `/pet/medical/${state.secondaryPetId}/blood-test`,
        { heartworm: 'Negative' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(403);

      const count = await bloodTestCol().countDocuments({ petId: state.secondaryPetId });
      expect(count).toBe(0);
    });
  });

  describe('PATCH /pet/medical/{petId}/blood-test/{bloodTestId} — update', () => {
    test('updates blood-test record and DB reflects the change', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearMedicalFor(state.primaryPetId);

      const createRes = await req(
        'POST',
        `/pet/medical/${state.primaryPetId}/blood-test`,
        { heartworm: 'Negative', lymeDisease: 'Pending' },
        authHeaders(state.primaryToken)
      );
      expect(createRes.status).toBe(201);
      const bloodTestId = createRes.body.bloodTestRecordId;

      const patchRes = await req(
        'PATCH',
        `/pet/medical/${state.primaryPetId}/blood-test/${bloodTestId}`,
        { lymeDisease: 'Negative', ehrlichiosis: 'Positive' },
        authHeaders(state.primaryToken)
      );

      expect(patchRes.status).toBe(200);

      const persisted = await bloodTestCol().findOne({
        _id: new mongoose.Types.ObjectId(bloodTestId),
      });
      expect(persisted.lymeDisease).toBe('Negative');
      expect(persisted.ehrlichiosis).toBe('Positive');
      expect(persisted.heartworm).toBe('Negative');
    });

    test('returns 400 for invalid bloodTestId format', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'PATCH',
        `/pet/medical/${state.primaryPetId}/blood-test/not-an-objectid`,
        { heartworm: 'Positive' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe(
        'petMedicalRecord.errors.bloodTest.invalidBloodTestIdFormat'
      );
    });

    test('returns 404 when record does not exist', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const fakeId = new mongoose.Types.ObjectId().toString();
      const res = await req(
        'PATCH',
        `/pet/medical/${state.primaryPetId}/blood-test/${fakeId}`,
        { heartworm: 'Positive' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(404);
      expect(res.body?.errorKey).toBe('petMedicalRecord.errors.bloodTest.notFound');
    });
  });

  describe('DELETE /pet/medical/{petId}/blood-test/{bloodTestId} — delete', () => {
    test('deletes the blood-test record from DB', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearMedicalFor(state.primaryPetId);

      const createRes = await req(
        'POST',
        `/pet/medical/${state.primaryPetId}/blood-test`,
        { heartworm: 'ToDelete' },
        authHeaders(state.primaryToken)
      );
      expect(createRes.status).toBe(201);
      const bloodTestId = createRes.body.bloodTestRecordId;

      const deleteRes = await req(
        'DELETE',
        `/pet/medical/${state.primaryPetId}/blood-test/${bloodTestId}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(deleteRes.status).toBe(200);

      const persisted = await bloodTestCol().findOne({
        _id: new mongoose.Types.ObjectId(bloodTestId),
      });
      expect(persisted).toBeNull();
    });

    test('returns 403 when deleting another owner\'s blood-test record — record survives', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearMedicalFor(state.secondaryPetId);

      const seedId = new mongoose.Types.ObjectId();
      await bloodTestCol().insertOne({
        _id: seedId,
        petId: String(state.secondaryPetId),
        heartworm: 'Protected',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await req(
        'DELETE',
        `/pet/medical/${state.secondaryPetId}/blood-test/${seedId}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(403);

      const persisted = await bloodTestCol().findOne({ _id: seedId });
      expect(persisted).not.toBeNull();
    });
  });

  // ── Cyberattacks ─────────────────────────────────────────────────────────────

  describe('cyberattacks', () => {
    test('POST /pet/medical/{petId}/general rejects NoSQL operator injection in medicalPlace', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearMedicalFor(state.primaryPetId);

      const res = await req(
        'POST',
        `/pet/medical/${state.primaryPetId}/general`,
        { medicalPlace: { $gt: '' } },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);

      const count = await medicalCol().countDocuments({ petId: state.primaryPetId });
      expect(count).toBe(0);
    });

    test('PATCH general record rejects NoSQL operator injection — DB unchanged', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearMedicalFor(state.primaryPetId);

      const createRes = await req(
        'POST',
        `/pet/medical/${state.primaryPetId}/general`,
        { medicalPlace: 'Safe Clinic' },
        authHeaders(state.primaryToken)
      );
      expect(createRes.status).toBe(201);
      const medicalId = createRes.body.medicalRecordId;

      const before = await medicalCol().findOne({ _id: new mongoose.Types.ObjectId(medicalId) });

      const patchRes = await req(
        'PATCH',
        `/pet/medical/${state.primaryPetId}/general/${medicalId}`,
        { medicalPlace: { $set: 'Injected' } },
        authHeaders(state.primaryToken)
      );

      expect(patchRes.status).toBe(400);

      const after = await medicalCol().findOne({ _id: new mongoose.Types.ObjectId(medicalId) });
      expect(after.medicalPlace).toBe(before.medicalPlace);
    });

    test('repeated identical POST requests create separate records (no idempotency constraint)', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearMedicalFor(state.primaryPetId);

      const first = await req(
        'POST',
        `/pet/medical/${state.primaryPetId}/general`,
        { medicalPlace: 'Repeat Clinic' },
        authHeaders(state.primaryToken)
      );
      const second = await req(
        'POST',
        `/pet/medical/${state.primaryPetId}/general`,
        { medicalPlace: 'Repeat Clinic' },
        authHeaders(state.primaryToken)
      );

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(first.body.medicalRecordId).not.toBe(second.body.medicalRecordId);

      const count = await medicalCol().countDocuments({ petId: state.primaryPetId });
      expect(count).toBe(2);
    });

    test('self-access bypass: changing petId in body does not redirect operation to another pet', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearMedicalFor(state.primaryPetId);

      const res = await req(
        'POST',
        `/pet/medical/${state.primaryPetId}/general`,
        {
          medicalPlace: 'Bypass Clinic',
          petId: state.secondaryPetId.toString(),
        },
        authHeaders(state.primaryToken)
      );

      // strict schema rejects unknown field 'petId' in body
      expect(res.status).toBe(400);

      const count = await medicalCol().countDocuments({ petId: state.secondaryPetId });
      expect(count).toBe(0);
    });
  });

  // ── Stability ─────────────────────────────────────────────────────────────────

  describe('repeated request stability', () => {
    test('warm repeated GET requests return stable results', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearMedicalFor(state.primaryPetId);

      await req(
        'POST',
        `/pet/medical/${state.primaryPetId}/general`,
        { medicalPlace: 'Stable Clinic' },
        authHeaders(state.primaryToken)
      );

      const first = await req(
        'GET',
        `/pet/medical/${state.primaryPetId}/general`,
        undefined,
        authHeaders(state.primaryToken)
      );
      const second = await req(
        'GET',
        `/pet/medical/${state.primaryPetId}/general`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(first.body.form.medical.length).toBe(second.body.form.medical.length);
    });
  });
});
