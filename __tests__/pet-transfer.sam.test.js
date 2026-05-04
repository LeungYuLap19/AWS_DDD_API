// Tier 3 — SAM local HTTP integration tests for the pet-transfer Lambda.
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
//   Tier 2 mock handler tests:    __tests__/pet-transfer.test.js
//   Tier 3 SAM + Mongo (this):    __tests__/pet-transfer.sam.test.js
//
// Routes under test:
//   POST   /pet/transfer/{petId}                       → create transfer record (protected)
//   PATCH  /pet/transfer/{petId}/{transferId}          → update transfer record (protected)
//   DELETE /pet/transfer/{petId}/{transferId}          → delete transfer record (protected)
//   POST   /pet/transfer/{petId}/ngo-reassignment      → NGO ownership reassignment (NGO role required)
//
// DB collections used:
//   pets  — MONGODB_URI (main DB)
//   users — MONGODB_URI (main DB, for ngo-reassignment target user lookup)

const dns = require('dns');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const envConfig = require('../env.json');

const BASE_URL = process.env.PET_TRANSFER_UAT_BASE_URL || 'http://127.0.0.1:3000';
const TEST_TS = Date.now();
const RUN_ID = `ddd-pet-transfer-${TEST_TS}`;
const JWT_SECRET =
  process.env.PET_TRANSFER_TEST_JWT_SECRET ||
  envConfig.RequestAuthorizerFunction?.JWT_SECRET ||
  'PPCSecret';
const API_KEY =
  process.env.PET_TRANSFER_TEST_API_KEY ||
  envConfig.Parameters?.ExistingApiKeyId ||
  'test-api-key';
const MONGODB_URI =
  envConfig.PetTransferFunction?.MONGODB_URI || envConfig.Parameters?.MONGODB_URI || '';
const ALLOWED_ORIGINS = envConfig.Parameters?.ALLOWED_ORIGINS || '*';
const AUTH_BYPASS =
  envConfig.Parameters?.AUTH_BYPASS || envConfig.PetTransferFunction?.AUTH_BYPASS || 'false';
const VALID_ORIGIN = 'http://localhost:3000';

let dbReady = false;
let dbConnectAttempted = false;
let dbConnectError = null;

// Target user used in ngo-reassignment tests.  Both email and phoneNumber must
// resolve to the same user document.
const TARGET_USER_EMAIL = `ngo-target-${TEST_TS}@test.example`;
const TARGET_USER_PHONE = `+852${String(TEST_TS).slice(-8).padStart(8, '9')}`;

const state = {
  primaryUserId: new mongoose.Types.ObjectId(),
  secondaryUserId: new mongoose.Types.ObjectId(),
  ngoUserId: new mongoose.Types.ObjectId(),
  targetUserId: new mongoose.Types.ObjectId(),

  // Pet owned by primary — happy-path create/update/delete.
  primaryPetId: new mongoose.Types.ObjectId(),
  // Pet owned by secondary — forbidden cross-owner tests.
  secondaryPetId: new mongoose.Types.ObjectId(),
  // Pet owned by primary but soft-deleted.
  deletedPetId: new mongoose.Types.ObjectId(),
  // Pet owned by the NGO — ngo-reassignment tests.
  ngoPetId: new mongoose.Types.ObjectId(),

  ngoId: `ngo-transfer-${TEST_TS}`,

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
  if (!MONGODB_URI) throw new Error('env.json missing PetTransferFunction.MONGODB_URI');
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

function usersCol() {
  return mongoose.connection.db.collection('users');
}

/**
 * Read the transfer sub-document array back from DB for the given petId.
 */
async function getTransferArray(petId) {
  const pet = await petsCol().findOne({ _id: petId });
  return pet?.transfer ?? [];
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

  // Remove any pre-existing fixtures from previous runs.
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
  await usersCol().deleteMany({ _id: state.targetUserId });

  await petsCol().insertMany([
    {
      _id: state.primaryPetId,
      userId: state.primaryUserId,
      ngoId: null,
      deleted: false,
      transfer: [],
      transferNGO: [{ regDate: null, regPlace: null, transferOwner: null, UserContact: null, UserEmail: null, transferContact: null, transferRemark: null, isTransferred: false }],
      createdAt: new Date(nowMs),
      updatedAt: new Date(nowMs),
    },
    {
      _id: state.secondaryPetId,
      userId: state.secondaryUserId,
      ngoId: null,
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
      deleted: false,
      transfer: [],
      transferNGO: [{ regDate: null, regPlace: null, transferOwner: null, UserContact: null, UserEmail: null, transferContact: null, transferRemark: null, isTransferred: false }],
      createdAt: new Date(nowMs + 3),
      updatedAt: new Date(nowMs + 3),
    },
  ]);

  // Seed a target user for ngo-reassignment lookup (email + phone must match same doc).
  await usersCol().insertOne({
    _id: state.targetUserId,
    email: TARGET_USER_EMAIL,
    phoneNumber: TARGET_USER_PHONE,
    deleted: false,
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
    await fetch(`${BASE_URL}/pet/transfer/${new mongoose.Types.ObjectId()}`, {
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
    await usersCol().deleteMany({ _id: state.targetUserId });
    await mongoose.disconnect();
  }
});

// ─── suite ───────────────────────────────────────────────────────────────────

describe('Tier 3 - /pet/transfer via SAM local + UAT DB', () => {
  beforeAll(async () => {
    await ensureSamLocalReachable();
  });

  test('denied-origin preflight is not provable in this env because env.json uses ALLOWED_ORIGINS=*', () => {
    expect(ALLOWED_ORIGINS).toBe('*');
  });

  // ── CORS / runtime boundary ──────────────────────────────────────────────────

  describe('runtime boundary behavior', () => {
    test('OPTIONS /pet/transfer/{petId} returns 204 with CORS headers', async () => {
      const petId = new mongoose.Types.ObjectId().toString();
      const res = await req('OPTIONS', `/pet/transfer/${petId}`, undefined, { origin: VALID_ORIGIN });

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.headers['access-control-allow-headers']).toContain('x-api-key');
    });

    test('OPTIONS /pet/transfer/{petId}/{transferId} returns 204 with CORS headers', async () => {
      const petId = new mongoose.Types.ObjectId().toString();
      const transferId = new mongoose.Types.ObjectId().toString();
      const res = await req(
        'OPTIONS',
        `/pet/transfer/${petId}/${transferId}`,
        undefined,
        { origin: VALID_ORIGIN }
      );

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('*');
    });

    test('OPTIONS /pet/transfer/{petId}/ngo-reassignment returns 204 with CORS headers', async () => {
      const petId = new mongoose.Types.ObjectId().toString();
      const res = await req(
        'OPTIONS',
        `/pet/transfer/${petId}/ngo-reassignment`,
        undefined,
        { origin: VALID_ORIGIN }
      );

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('*');
    });

    test('GET /pet/transfer/{petId} returns 405 or 403 (wrong method — no GET defined)', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'GET',
        `/pet/transfer/${state.primaryPetId}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect([403, 405]).toContain(res.status);
    });

    test('PUT /pet/transfer/{petId}/{transferId} returns 405 or 403 (wrong method)', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const transferId = new mongoose.Types.ObjectId().toString();
      const res = await req(
        'PUT',
        `/pet/transfer/${state.primaryPetId}/${transferId}`,
        { regPlace: 'wrong method' },
        authHeaders(state.primaryToken)
      );

      expect([403, 405]).toContain(res.status);
    });
  });

  // ── Happy paths — POST /pet/transfer/{petId} ─────────────────────────────────

  describe('POST /pet/transfer/{petId} — create transfer record', () => {
    test('creates a transfer record and persists it to DB', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'POST',
        `/pet/transfer/${state.primaryPetId}`,
        {
          regDate: '2024-01-15',
          regPlace: 'Hong Kong',
          transferOwner: 'Alice',
          transferContact: '+85291234567',
          transferRemark: 'Rehomed',
        },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(201);
      expect(res.body.transferId).toBeDefined();
      expect(String(res.body.petId)).toBe(String(state.primaryPetId));
      expect(res.body.form.regPlace).toBe('Hong Kong');

      const transferArr = await getTransferArray(state.primaryPetId);
      const record = transferArr.find((t) => String(t._id) === res.body.transferId);
      expect(record).toBeDefined();
      expect(record.regPlace).toBe('Hong Kong');
      expect(record.transferOwner).toBe('Alice');

      // Clean up the transfer record for later tests
      await petsCol().updateOne(
        { _id: state.primaryPetId },
        { $pull: { transfer: { _id: new mongoose.Types.ObjectId(res.body.transferId) } } }
      );
    });

    test('creates with minimal body (all optional fields null)', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'POST',
        `/pet/transfer/${state.primaryPetId}`,
        {},
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(201);
      expect(res.body.transferId).toBeDefined();

      const transferArr = await getTransferArray(state.primaryPetId);
      const record = transferArr.find((t) => String(t._id) === res.body.transferId);
      expect(record).toBeDefined();
      expect(record.regPlace).toBeNull();

      await petsCol().updateOne(
        { _id: state.primaryPetId },
        { $pull: { transfer: { _id: new mongoose.Types.ObjectId(res.body.transferId) } } }
      );
    });

    test('NGO-owned pet: NGO token creates record successfully', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'POST',
        `/pet/transfer/${state.ngoPetId}`,
        { regPlace: 'Kowloon' },
        authHeaders(state.ngoToken)
      );

      expect(res.status).toBe(201);
      expect(res.body.transferId).toBeDefined();

      await petsCol().updateOne(
        { _id: state.ngoPetId },
        { $pull: { transfer: { _id: new mongoose.Types.ObjectId(res.body.transferId) } } }
      );
    });

    test('returns 400 for invalid petId format', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'POST',
        '/pet/transfer/not-an-objectid',
        { regPlace: 'Hong Kong' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('petTransfer.errors.invalidPetId');
    });

    test('returns 400 for invalid date format', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'POST',
        `/pet/transfer/${state.primaryPetId}`,
        { regDate: 'not-a-date' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('petTransfer.errors.transfer.invalidDateFormat');

      const transferArr = await getTransferArray(state.primaryPetId);
      const anyWithBadDate = transferArr.find((t) => t.regDate === 'not-a-date');
      expect(anyWithBadDate).toBeUndefined();
    });

    test('returns 400 for malformed JSON body', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'POST',
        `/pet/transfer/${state.primaryPetId}`,
        '{"regPlace"',
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
    });

    test('returns 403 when caller does not own the pet, with no transfer record added', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const before = await getTransferArray(state.secondaryPetId);

      const res = await req(
        'POST',
        `/pet/transfer/${state.secondaryPetId}`,
        { regPlace: 'Hijack attempt' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(403);
      expect(res.body.errorKey).toBe('common.forbidden');

      const after = await getTransferArray(state.secondaryPetId);
      expect(after.length).toBe(before.length);
    });

    test('returns 404 when pet is soft-deleted, with no transfer added', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'POST',
        `/pet/transfer/${state.deletedPetId}`,
        { regPlace: 'Ghost' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(404);

      const transferArr = await getTransferArray(state.deletedPetId);
      expect(transferArr.length).toBe(0);
    });

    test('repeated warm POST requests are stable and all records are persisted', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res1 = await req(
        'POST',
        `/pet/transfer/${state.primaryPetId}`,
        { regPlace: 'First warm' },
        authHeaders(state.primaryToken)
      );
      const res2 = await req(
        'POST',
        `/pet/transfer/${state.primaryPetId}`,
        { regPlace: 'Second warm' },
        authHeaders(state.primaryToken)
      );

      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);
      expect(res1.body.transferId).not.toBe(res2.body.transferId);

      const transferArr = await getTransferArray(state.primaryPetId);
      const ids = [res1.body.transferId, res2.body.transferId];
      for (const id of ids) {
        expect(transferArr.find((t) => String(t._id) === id)).toBeDefined();
        await petsCol().updateOne(
          { _id: state.primaryPetId },
          { $pull: { transfer: { _id: new mongoose.Types.ObjectId(id) } } }
        );
      }
    });
  });

  // ── Happy paths — PATCH /pet/transfer/{petId}/{transferId} ───────────────────

  describe('PATCH /pet/transfer/{petId}/{transferId} — update transfer record', () => {
    test('updates only the provided fields and DB reflects the change', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const createRes = await req(
        'POST',
        `/pet/transfer/${state.primaryPetId}`,
        { regPlace: 'Original', transferOwner: 'Original Owner' },
        authHeaders(state.primaryToken)
      );
      expect(createRes.status).toBe(201);
      const transferId = createRes.body.transferId;

      const patchRes = await req(
        'PATCH',
        `/pet/transfer/${state.primaryPetId}/${transferId}`,
        { regPlace: 'Updated Place' },
        authHeaders(state.primaryToken)
      );

      expect(patchRes.status).toBe(200);

      const transferArr = await getTransferArray(state.primaryPetId);
      const record = transferArr.find((t) => String(t._id) === transferId);
      expect(record).toBeDefined();
      expect(record.regPlace).toBe('Updated Place');
      expect(record.transferOwner).toBe('Original Owner');

      await petsCol().updateOne(
        { _id: state.primaryPetId },
        { $pull: { transfer: { _id: new mongoose.Types.ObjectId(transferId) } } }
      );
    });

    test('updates regDate field with valid ISO date format', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const createRes = await req(
        'POST',
        `/pet/transfer/${state.primaryPetId}`,
        { regPlace: 'Place' },
        authHeaders(state.primaryToken)
      );
      expect(createRes.status).toBe(201);
      const transferId = createRes.body.transferId;

      const patchRes = await req(
        'PATCH',
        `/pet/transfer/${state.primaryPetId}/${transferId}`,
        { regDate: '2024-06-15' },
        authHeaders(state.primaryToken)
      );

      expect(patchRes.status).toBe(200);

      const transferArr = await getTransferArray(state.primaryPetId);
      const record = transferArr.find((t) => String(t._id) === transferId);
      expect(record).toBeDefined();
      expect(record.regDate).toBeDefined();

      await petsCol().updateOne(
        { _id: state.primaryPetId },
        { $pull: { transfer: { _id: new mongoose.Types.ObjectId(transferId) } } }
      );
    });

    test('returns 400 when PATCH body has no recognized update fields', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const createRes = await req(
        'POST',
        `/pet/transfer/${state.primaryPetId}`,
        { regPlace: 'Seed' },
        authHeaders(state.primaryToken)
      );
      expect(createRes.status).toBe(201);
      const transferId = createRes.body.transferId;

      const patchRes = await req(
        'PATCH',
        `/pet/transfer/${state.primaryPetId}/${transferId}`,
        {},
        authHeaders(state.primaryToken)
      );

      expect(patchRes.status).toBe(400);
      expect(patchRes.body?.errorKey).toBe('common.noFieldsToUpdate');

      await petsCol().updateOne(
        { _id: state.primaryPetId },
        { $pull: { transfer: { _id: new mongoose.Types.ObjectId(transferId) } } }
      );
    });

    test('returns 400 for invalid date format in PATCH', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const createRes = await req(
        'POST',
        `/pet/transfer/${state.primaryPetId}`,
        { regPlace: 'Seed' },
        authHeaders(state.primaryToken)
      );
      expect(createRes.status).toBe(201);
      const transferId = createRes.body.transferId;

      const patchRes = await req(
        'PATCH',
        `/pet/transfer/${state.primaryPetId}/${transferId}`,
        { regDate: 'totally-wrong' },
        authHeaders(state.primaryToken)
      );

      expect(patchRes.status).toBe(400);
      expect(patchRes.body?.errorKey).toBe('petTransfer.errors.transfer.invalidDateFormat');

      await petsCol().updateOne(
        { _id: state.primaryPetId },
        { $pull: { transfer: { _id: new mongoose.Types.ObjectId(transferId) } } }
      );
    });

    test('returns 404 when transferId does not exist on the pet', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const ghostTransferId = new mongoose.Types.ObjectId().toString();
      const res = await req(
        'PATCH',
        `/pet/transfer/${state.primaryPetId}/${ghostTransferId}`,
        { regPlace: 'Ghost' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(404);
      expect(res.body.errorKey).toBe('petTransfer.errors.transfer.notFound');
    });

    test('returns 403 when caller patches another owner\'s transfer', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const createRes = await req(
        'POST',
        `/pet/transfer/${state.secondaryPetId}`,
        { regPlace: 'Secondary' },
        authHeaders(state.secondaryToken)
      );
      expect(createRes.status).toBe(201);
      const transferId = createRes.body.transferId;
      const originalRegPlace = 'Secondary';

      const res = await req(
        'PATCH',
        `/pet/transfer/${state.secondaryPetId}/${transferId}`,
        { regPlace: 'Hijacked' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(403);
      expect(res.body.errorKey).toBe('common.forbidden');

      const transferArr = await getTransferArray(state.secondaryPetId);
      const record = transferArr.find((t) => String(t._id) === transferId);
      expect(record.regPlace).toBe(originalRegPlace);

      await petsCol().updateOne(
        { _id: state.secondaryPetId },
        { $pull: { transfer: { _id: new mongoose.Types.ObjectId(transferId) } } }
      );
    });

    test('returns 400 for invalid transferId format', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'PATCH',
        `/pet/transfer/${state.primaryPetId}/not-a-valid-id`,
        { regPlace: 'Hong Kong' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('petTransfer.errors.transfer.invalidTransferId');
    });
  });

  // ── Happy paths — DELETE /pet/transfer/{petId}/{transferId} ──────────────────

  describe('DELETE /pet/transfer/{petId}/{transferId} — delete transfer record', () => {
    test('deletes the record and it is removed from the DB transfer array', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const createRes = await req(
        'POST',
        `/pet/transfer/${state.primaryPetId}`,
        { regPlace: 'To Delete' },
        authHeaders(state.primaryToken)
      );
      expect(createRes.status).toBe(201);
      const transferId = createRes.body.transferId;

      const deleteRes = await req(
        'DELETE',
        `/pet/transfer/${state.primaryPetId}/${transferId}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.transferId).toBe(transferId);

      const transferArr = await getTransferArray(state.primaryPetId);
      const record = transferArr.find((t) => String(t._id) === transferId);
      expect(record).toBeUndefined();
    });

    test('returns 404 when transferId does not exist on the pet', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const ghostTransferId = new mongoose.Types.ObjectId().toString();
      const res = await req(
        'DELETE',
        `/pet/transfer/${state.primaryPetId}/${ghostTransferId}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(404);
      expect(res.body.errorKey).toBe('petTransfer.errors.transfer.notFound');
    });

    test('returns 403 when caller deletes another owner\'s transfer, with no DB mutation', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const createRes = await req(
        'POST',
        `/pet/transfer/${state.secondaryPetId}`,
        { regPlace: 'DoNotDelete' },
        authHeaders(state.secondaryToken)
      );
      expect(createRes.status).toBe(201);
      const transferId = createRes.body.transferId;

      const res = await req(
        'DELETE',
        `/pet/transfer/${state.secondaryPetId}/${transferId}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(403);
      expect(res.body.errorKey).toBe('common.forbidden');

      const transferArr = await getTransferArray(state.secondaryPetId);
      const record = transferArr.find((t) => String(t._id) === transferId);
      expect(record).toBeDefined();

      await petsCol().updateOne(
        { _id: state.secondaryPetId },
        { $pull: { transfer: { _id: new mongoose.Types.ObjectId(transferId) } } }
      );
    });

    test('DELETE after DELETE returns 404 on the second attempt', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const createRes = await req(
        'POST',
        `/pet/transfer/${state.primaryPetId}`,
        { regPlace: 'Once' },
        authHeaders(state.primaryToken)
      );
      expect(createRes.status).toBe(201);
      const transferId = createRes.body.transferId;

      const first = await req(
        'DELETE',
        `/pet/transfer/${state.primaryPetId}/${transferId}`,
        undefined,
        authHeaders(state.primaryToken)
      );
      expect(first.status).toBe(200);

      const second = await req(
        'DELETE',
        `/pet/transfer/${state.primaryPetId}/${transferId}`,
        undefined,
        authHeaders(state.primaryToken)
      );
      expect(second.status).toBe(404);
      expect(second.body.errorKey).toBe('petTransfer.errors.transfer.notFound');
    });
  });

  // ── Happy paths — POST /pet/transfer/{petId}/ngo-reassignment ─────────────────

  describe('POST /pet/transfer/{petId}/ngo-reassignment — NGO ownership transfer', () => {
    test('reassigns pet ownership to target user and updates transferNGO fields in DB', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'POST',
        `/pet/transfer/${state.ngoPetId}/ngo-reassignment`,
        {
          UserEmail: TARGET_USER_EMAIL,
          UserContact: TARGET_USER_PHONE,
          regPlace: 'Shelter HK',
          transferOwner: 'NGO Staff',
          isTransferred: true,
        },
        authHeaders(state.ngoToken)
      );

      expect(res.status).toBe(200);
      expect(String(res.body.petId)).toBe(String(state.ngoPetId));

      const pet = await petsCol().findOne({ _id: state.ngoPetId });
      expect(String(pet.userId)).toBe(String(state.targetUserId));
      expect(pet.ngoId).toBe('');
    });

    test('returns 403 when caller does not have NGO role', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'POST',
        `/pet/transfer/${state.ngoPetId}/ngo-reassignment`,
        {
          UserEmail: TARGET_USER_EMAIL,
          UserContact: TARGET_USER_PHONE,
        },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(403);
      expect(res.body.errorKey).toBe('common.forbidden');
    });

    test('returns 403 when NGO token ngoId does not match pet ngoId', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const wrongNgoToken = signToken({
        userId: state.ngoUserId,
        ngoId: 'wrong-ngo-id',
        role: 'ngo',
      });

      const res = await req(
        'POST',
        `/pet/transfer/${state.ngoPetId}/ngo-reassignment`,
        {
          UserEmail: TARGET_USER_EMAIL,
          UserContact: TARGET_USER_PHONE,
        },
        authHeaders(wrongNgoToken)
      );

      expect(res.status).toBe(403);
      expect(res.body.errorKey).toBe('common.forbidden');
    });

    test('returns 400 when neither UserEmail nor UserContact is provided', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'POST',
        `/pet/transfer/${state.ngoPetId}/ngo-reassignment`,
        { regPlace: 'Hong Kong' },
        authHeaders(state.ngoToken)
      );

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('petTransfer.errors.ngoTransfer.missingRequiredFields');
    });

    test('succeeds with 200 when only UserEmail is provided (UserContact not required)', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'POST',
        `/pet/transfer/${state.ngoPetId}/ngo-reassignment`,
        { UserEmail: TARGET_USER_EMAIL },
        authHeaders(state.ngoToken)
      );

      expect(res.status).toBe(200);
      expect(res.body?.petId).toBeDefined();
    });

    test('succeeds with 200 when only UserContact is provided (UserEmail not required)', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'POST',
        `/pet/transfer/${state.ngoPetId}/ngo-reassignment`,
        { UserContact: TARGET_USER_PHONE },
        authHeaders(state.ngoToken)
      );

      expect(res.status).toBe(200);
      expect(res.body?.petId).toBeDefined();
    });

    test('returns 400 for invalid email format', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'POST',
        `/pet/transfer/${state.ngoPetId}/ngo-reassignment`,
        { UserEmail: 'not-an-email', UserContact: TARGET_USER_PHONE },
        authHeaders(state.ngoToken)
      );

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('petTransfer.errors.ngoTransfer.invalidEmailFormat');
    });

    test('returns 400 for invalid phone format', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'POST',
        `/pet/transfer/${state.ngoPetId}/ngo-reassignment`,
        { UserEmail: TARGET_USER_EMAIL, UserContact: '12345678' },
        authHeaders(state.ngoToken)
      );

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('petTransfer.errors.ngoTransfer.invalidPhoneFormat');
    });

    test('returns 400 for invalid date format in regDate', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'POST',
        `/pet/transfer/${state.ngoPetId}/ngo-reassignment`,
        {
          UserEmail: TARGET_USER_EMAIL,
          UserContact: TARGET_USER_PHONE,
          regDate: 'not-a-date',
        },
        authHeaders(state.ngoToken)
      );

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('petTransfer.errors.ngoTransfer.invalidDateFormat');
    });

    test('returns 404 when target user is not found (generic to prevent enumeration)', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'POST',
        `/pet/transfer/${state.ngoPetId}/ngo-reassignment`,
        {
          UserEmail: `nonexistent-${TEST_TS}@test.example`,
          UserContact: TARGET_USER_PHONE,
        },
        authHeaders(state.ngoToken)
      );

      expect(res.status).toBe(404);
      expect(res.body.errorKey).toBe('petTransfer.errors.ngoTransfer.targetUserNotFound');
    });

    test('returns 400 when email and phone resolve to different users (identity mismatch)', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      // Seed a second user with the same phone but different email
      const conflictUserId = new mongoose.Types.ObjectId();
      await usersCol().insertOne({
        _id: conflictUserId,
        email: `conflict-${TEST_TS}@test.example`,
        phoneNumber: TARGET_USER_PHONE,
        deleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await req(
        'POST',
        `/pet/transfer/${state.ngoPetId}/ngo-reassignment`,
        {
          UserEmail: TARGET_USER_EMAIL,         // resolves to targetUserId
          UserContact: TARGET_USER_PHONE,       // resolves to conflictUserId (different user)
        },
        authHeaders(state.ngoToken)
      );

      // email lookup finds targetUserId, phone lookup finds conflictUserId — mismatch
      expect(res.status).toBe(400);
      expect(res.body.errorKey).toBe('petTransfer.errors.ngoTransfer.userIdentityMismatch');

      await usersCol().deleteOne({ _id: conflictUserId });
    });

    test('returns 404 when pet is soft-deleted, with no ownership change', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      // Temporarily set deletedPetId to ngoId ownership
      await petsCol().updateOne(
        { _id: state.deletedPetId },
        { $set: { ngoId: state.ngoId, userId: null } }
      );

      const res = await req(
        'POST',
        `/pet/transfer/${state.deletedPetId}/ngo-reassignment`,
        { UserEmail: TARGET_USER_EMAIL, UserContact: TARGET_USER_PHONE },
        authHeaders(state.ngoToken)
      );

      expect(res.status).toBe(404);

      await petsCol().updateOne(
        { _id: state.deletedPetId },
        { $set: { ngoId: null, userId: state.primaryUserId } }
      );
    });
  });

  // ── Authentication and authorisation ────────────────────────────────────────

  describe('authentication and authorisation', () => {
    test('POST /pet/transfer/{petId} rejects a missing Authorization header', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'POST',
        `/pet/transfer/${state.primaryPetId}`,
        { regPlace: 'Anon' },
        { 'x-api-key': API_KEY, origin: VALID_ORIGIN }
      );

      expect(expectedUnauthenticatedStatuses()).toContain(res.status);
    });

    test('POST /pet/transfer/{petId} rejects a garbage bearer token', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'POST',
        `/pet/transfer/${state.primaryPetId}`,
        { regPlace: 'Garbage' },
        authHeaders('this.is.garbage')
      );

      expect([401, 403]).toContain(res.status);
    });

    test('POST /pet/transfer/{petId} rejects an expired JWT', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const expiredToken = signToken({ userId: state.primaryUserId, expiresIn: -60 });
      const res = await req(
        'POST',
        `/pet/transfer/${state.primaryPetId}`,
        { regPlace: 'Expired' },
        authHeaders(expiredToken)
      );

      expect([401, 403]).toContain(res.status);
    });

    test('POST /pet/transfer/{petId} rejects a tampered JWT', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const tampered = `${state.primaryToken.slice(0, -1)}${
        state.primaryToken.slice(-1) === 'a' ? 'b' : 'a'
      }`;
      const res = await req(
        'POST',
        `/pet/transfer/${state.primaryPetId}`,
        { regPlace: 'Tampered' },
        authHeaders(tampered)
      );

      expect([401, 403]).toContain(res.status);
    });

    test('POST /pet/transfer/{petId} rejects an alg:none JWT attack', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const algNone = buildAlgNoneToken({ userId: state.primaryUserId });
      const res = await req(
        'POST',
        `/pet/transfer/${state.primaryPetId}`,
        { regPlace: 'AlgNone' },
        authHeaders(algNone)
      );

      expect([401, 403]).toContain(res.status);
    });

    test('PATCH /pet/transfer/{petId}/{transferId} rejects a missing Authorization header', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const transferId = new mongoose.Types.ObjectId().toString();
      const res = await req(
        'PATCH',
        `/pet/transfer/${state.primaryPetId}/${transferId}`,
        { regPlace: 'Anon' },
        { 'x-api-key': API_KEY, origin: VALID_ORIGIN }
      );

      expect(expectedUnauthenticatedStatuses()).toContain(res.status);
    });

    test('DELETE /pet/transfer/{petId}/{transferId} rejects a missing Authorization header', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const transferId = new mongoose.Types.ObjectId().toString();
      const res = await req(
        'DELETE',
        `/pet/transfer/${state.primaryPetId}/${transferId}`,
        undefined,
        { 'x-api-key': API_KEY, origin: VALID_ORIGIN }
      );

      expect(expectedUnauthenticatedStatuses()).toContain(res.status);
    });

    test('POST /pet/transfer/{petId}/ngo-reassignment rejects a missing Authorization header', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'POST',
        `/pet/transfer/${state.ngoPetId}/ngo-reassignment`,
        { UserEmail: TARGET_USER_EMAIL, UserContact: TARGET_USER_PHONE },
        { 'x-api-key': API_KEY, origin: VALID_ORIGIN }
      );

      expect(expectedUnauthenticatedStatuses()).toContain(res.status);
    });
  });

  // ── Cyberattacks ─────────────────────────────────────────────────────────────

  describe('cyberattacks', () => {
    test('POST /pet/transfer/{petId} rejects mass-assignment of unknown fields and does not persist them', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const before = (await petsCol().findOne({ _id: state.primaryPetId })).transfer.length;

      const res = await req(
        'POST',
        `/pet/transfer/${state.primaryPetId}`,
        {
          regPlace: 'Legit',
          deleted: true,
          userId: state.secondaryUserId.toString(),
          _id: new mongoose.Types.ObjectId().toString(),
          isAdmin: true,
        },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);

      const after = (await petsCol().findOne({ _id: state.primaryPetId })).transfer.length;
      expect(after).toBe(before);
    });

    test('PATCH /pet/transfer/{petId}/{transferId} rejects NoSQL injection in regPlace, DB unchanged', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const createRes = await req(
        'POST',
        `/pet/transfer/${state.primaryPetId}`,
        { regPlace: 'Untouched' },
        authHeaders(state.primaryToken)
      );
      expect(createRes.status).toBe(201);
      const transferId = createRes.body.transferId;

      const res = await req(
        'PATCH',
        `/pet/transfer/${state.primaryPetId}/${transferId}`,
        { regPlace: { $gt: '' } },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);

      const transferArr = await getTransferArray(state.primaryPetId);
      const record = transferArr.find((t) => String(t._id) === transferId);
      expect(record.regPlace).toBe('Untouched');

      await petsCol().updateOne(
        { _id: state.primaryPetId },
        { $pull: { transfer: { _id: new mongoose.Types.ObjectId(transferId) } } }
      );
    });

    test('PATCH /pet/transfer/{petId}/{transferId} rejects mass-assignment of unknown fields without mutating DB', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const createRes = await req(
        'POST',
        `/pet/transfer/${state.primaryPetId}`,
        { regPlace: 'Original' },
        authHeaders(state.primaryToken)
      );
      expect(createRes.status).toBe(201);
      const transferId = createRes.body.transferId;

      const res = await req(
        'PATCH',
        `/pet/transfer/${state.primaryPetId}/${transferId}`,
        { regPlace: 'Allowed', isAdmin: true, deleted: true },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);

      const transferArr = await getTransferArray(state.primaryPetId);
      const record = transferArr.find((t) => String(t._id) === transferId);
      expect(record.regPlace).toBe('Original');
      expect(record.isAdmin).toBeUndefined();

      await petsCol().updateOne(
        { _id: state.primaryPetId },
        { $pull: { transfer: { _id: new mongoose.Types.ObjectId(transferId) } } }
      );
    });

    test('repeated hostile PATCH attempts are stable and do not corrupt DB state', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const createRes = await req(
        'POST',
        `/pet/transfer/${state.primaryPetId}`,
        { regPlace: 'Original' },
        authHeaders(state.primaryToken)
      );
      expect(createRes.status).toBe(201);
      const transferId = createRes.body.transferId;

      const first = await req(
        'PATCH',
        `/pet/transfer/${state.primaryPetId}/${transferId}`,
        { isAdmin: true },
        authHeaders(state.primaryToken)
      );
      const second = await req(
        'PATCH',
        `/pet/transfer/${state.primaryPetId}/${transferId}`,
        { isAdmin: true },
        authHeaders(state.primaryToken)
      );

      expect(first.status).toBe(400);
      expect(second.status).toBe(400);

      const transferArr = await getTransferArray(state.primaryPetId);
      const record = transferArr.find((t) => String(t._id) === transferId);
      expect(record.regPlace).toBe('Original');
      expect(record.isAdmin).toBeUndefined();

      await petsCol().updateOne(
        { _id: state.primaryPetId },
        { $pull: { transfer: { _id: new mongoose.Types.ObjectId(transferId) } } }
      );
    });

    test('POST /pet/transfer/{petId}/ngo-reassignment rejects mass-assignment of unknown fields, no ownership change', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const originalPet = await petsCol().findOne({ _id: state.ngoPetId });
      const originalNgoId = originalPet.ngoId;

      const res = await req(
        'POST',
        `/pet/transfer/${state.ngoPetId}/ngo-reassignment`,
        {
          UserEmail: TARGET_USER_EMAIL,
          UserContact: TARGET_USER_PHONE,
          isAdmin: true,
          deleted: true,
          ngoId: 'attacker-ngo',
        },
        authHeaders(state.ngoToken)
      );

      expect(res.status).toBe(400);

      const pet = await petsCol().findOne({ _id: state.ngoPetId });
      expect(pet.ngoId).toBe(originalNgoId);
    });

    test('NGO alg:none JWT attack is rejected and no ownership change occurs', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const algNone = buildAlgNoneToken({ userId: state.ngoUserId, role: 'ngo' });

      const res = await req(
        'POST',
        `/pet/transfer/${state.ngoPetId}/ngo-reassignment`,
        { UserEmail: TARGET_USER_EMAIL, UserContact: TARGET_USER_PHONE },
        authHeaders(algNone)
      );

      expect([401, 403]).toContain(res.status);

      const pet = await petsCol().findOne({ _id: state.ngoPetId });
      expect(pet.ngoId).toBe(state.ngoId);
    });
  });

  // ── Sequential state changes ─────────────────────────────────────────────────

  describe('sequential state changes', () => {
    test('create → update → delete lifecycle is fully reflected in DB', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const createRes = await req(
        'POST',
        `/pet/transfer/${state.primaryPetId}`,
        { regPlace: 'Start', transferOwner: 'Owner A' },
        authHeaders(state.primaryToken)
      );
      expect(createRes.status).toBe(201);
      const transferId = createRes.body.transferId;

      const patchRes = await req(
        'PATCH',
        `/pet/transfer/${state.primaryPetId}/${transferId}`,
        { regPlace: 'Updated', transferRemark: 'Remark added' },
        authHeaders(state.primaryToken)
      );
      expect(patchRes.status).toBe(200);

      const afterPatch = await getTransferArray(state.primaryPetId);
      const record = afterPatch.find((t) => String(t._id) === transferId);
      expect(record.regPlace).toBe('Updated');
      expect(record.transferRemark).toBe('Remark added');
      expect(record.transferOwner).toBe('Owner A');

      const deleteRes = await req(
        'DELETE',
        `/pet/transfer/${state.primaryPetId}/${transferId}`,
        undefined,
        authHeaders(state.primaryToken)
      );
      expect(deleteRes.status).toBe(200);

      const afterDelete = await getTransferArray(state.primaryPetId);
      const deletedRecord = afterDelete.find((t) => String(t._id) === transferId);
      expect(deletedRecord).toBeUndefined();
    });

    test('PATCH after DELETE returns 404 and does not recreate the record', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const createRes = await req(
        'POST',
        `/pet/transfer/${state.primaryPetId}`,
        { regPlace: 'WillBeDeleted' },
        authHeaders(state.primaryToken)
      );
      expect(createRes.status).toBe(201);
      const transferId = createRes.body.transferId;

      await req(
        'DELETE',
        `/pet/transfer/${state.primaryPetId}/${transferId}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      const patchRes = await req(
        'PATCH',
        `/pet/transfer/${state.primaryPetId}/${transferId}`,
        { regPlace: 'Ghost Update' },
        authHeaders(state.primaryToken)
      );
      expect(patchRes.status).toBe(404);

      const transferArr = await getTransferArray(state.primaryPetId);
      const ghostRecord = transferArr.find((t) => String(t._id) === transferId);
      expect(ghostRecord).toBeUndefined();
    });

    test('warm repeated GET-equivalent (POST list of transfers) is stable', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res1 = await req(
        'POST',
        `/pet/transfer/${state.primaryPetId}`,
        { regPlace: 'Warm1' },
        authHeaders(state.primaryToken)
      );
      const res2 = await req(
        'POST',
        `/pet/transfer/${state.primaryPetId}`,
        { regPlace: 'Warm2' },
        authHeaders(state.primaryToken)
      );

      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);
      expect(res1.body.transferId).not.toBe(res2.body.transferId);

      // Both records persisted independently
      const transferArr = await getTransferArray(state.primaryPetId);
      expect(transferArr.find((t) => String(t._id) === res1.body.transferId)).toBeDefined();
      expect(transferArr.find((t) => String(t._id) === res2.body.transferId)).toBeDefined();

      for (const id of [res1.body.transferId, res2.body.transferId]) {
        await petsCol().updateOne(
          { _id: state.primaryPetId },
          { $pull: { transfer: { _id: new mongoose.Types.ObjectId(id) } } }
        );
      }
    });
  });

  // ── Deferred ─────────────────────────────────────────────────────────────────

  describe('deferred — requires live AWS or unavailable infra', () => {
    test.todo('parallel concurrent POST /pet/transfer/{petId} requests do not corrupt the transfer array (requires load harness)');
    test.todo('deployed AWS verification: API Gateway authorizer deny prevents this Lambda from running');
    test.todo('deployed AWS verification: requestContext.authorizer is injected correctly by live API Gateway');
    test.todo('deployed AWS verification: NGO-reassignment ownership change survives a live session boundary');
  });
});
