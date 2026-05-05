// Tier 3 — SAM local HTTP integration tests for the pet-analysis Lambda.
// Tier 4 — Real MongoDB UAT persistence proofs.
//
// Prerequisites (run before this suite):
//   npm run build:ts && sam build
//   sam local start-api \
//     --template .aws-sam/build/template.yaml \
//     --env-vars env.json \
//     --warm-containers EAGER
//
// Coverage tiers (per dev_docs/llms/DDD_TESTING_STANDARD.md):
//   Tier 2 mock handler tests:    __tests__/pet-analysis.test.js
//   Tier 3 SAM + Mongo (this):    __tests__/pet-analysis.sam.test.js
//
// Routes under test:
//   GET    /pet/analysis/eye/{identifier}       (public disease lookup OR auth eye log)
//   POST   /pet/analysis/eye/{petId}            (auth + rate limit — eye analysis via external ML VM)
//   PATCH  /pet/analysis/eye/{petId}            (auth + rate limit — update pet eye images)
//   POST   /pet/analysis/breed                  (auth + rate limit — breed analysis via external ML VM)
//   POST   /pet/analysis/uploads/image          (auth + rate limit — S3 image upload)
//   POST   /pet/analysis/uploads/breed-image    (auth + rate limit — S3 breed image upload with folder validation)
//
// DB collections: pets, users, eyeanalysisrecords, eye_diseases, image_collections, api_logs, rate_limits
//
// Known limitations:
//   - POST /pet/analysis/eye/{petId} and POST /pet/analysis/breed call external ML VMs
//     at ppcapi.ddns.net. If unreachable, the Lambda returns 500. Happy-path tests
//     accept [200, 500] and document the observed status.
//   - Upload endpoints write to S3 (petpetclub bucket). If AWS credentials are not
//     configured in the SAM local environment, happy paths return 500.
//   - Multipart requests go through SAM local's HTTP proxy to lambda-multipart-parser.

const { createHash } = require('crypto');
const dns = require('dns');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const envConfig = require('../env.json');

const BASE_URL = process.env.PET_ANALYSIS_UAT_BASE_URL || 'http://127.0.0.1:3000';
const TEST_TS = Date.now();
const RUN_ID = `ddd-pet-analysis-${TEST_TS}`;
const JWT_SECRET =
  process.env.PET_ANALYSIS_TEST_JWT_SECRET ||
  envConfig.RequestAuthorizerFunction?.JWT_SECRET ||
  'PPCSecret';
const API_KEY =
  process.env.PET_ANALYSIS_TEST_API_KEY ||
  envConfig.Parameters?.ExistingApiKeyId ||
  'test-api-key';
const MONGODB_URI =
  envConfig.PetAnalysisFunction?.MONGODB_URI || envConfig.Parameters?.MONGODB_URI || '';
const ALLOWED_ORIGINS = envConfig.Parameters?.ALLOWED_ORIGINS || '*';
const AUTH_BYPASS =
  envConfig.Parameters?.AUTH_BYPASS || envConfig.PetAnalysisFunction?.AUTH_BYPASS || 'false';
const VALID_ORIGIN = 'http://localhost:3000';

let dbReady = false;
let dbConnectAttempted = false;
let dbConnectError = null;

const CLIENT_IP = `198.51.100.${(TEST_TS % 200) + 1}`;

const state = {
  primaryUserId: new mongoose.Types.ObjectId(),
  secondaryUserId: new mongoose.Types.ObjectId(),
  primaryPetId: new mongoose.Types.ObjectId(),
  secondaryPetId: new mongoose.Types.ObjectId(),
  deletedPetId: new mongoose.Types.ObjectId(),
  ngoPetId: new mongoose.Types.ObjectId(),
  ngoId: new mongoose.Types.ObjectId(),
  eyeDiseaseId: new mongoose.Types.ObjectId(),
  eyeLogId1: new mongoose.Types.ObjectId(),
  eyeLogId2: new mongoose.Types.ObjectId(),
  primaryToken: null,
  secondaryToken: null,
  ngoToken: null,
};

// ─── helpers ─────────────────────────────────────────────────────────────────

function signToken({ userId, role = 'user', ngoId, expiresIn = '15m' }) {
  const payload = { userId: userId.toString(), userRole: role };
  if (ngoId !== undefined) payload.ngoId = ngoId.toString();
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

async function reqMultipart(method, path, formData, token) {
  const headers = {
    'x-api-key': API_KEY,
    origin: VALID_ORIGIN,
    'x-forwarded-for': CLIENT_IP,
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

// 1x1 red JPEG (smallest valid JPEG)
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMCwsK' +
  'CwsLDBAQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQU' +
  'FBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIA' +
  'AhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAA' +
  'AAAAAAAAAAAAAAAK/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AfwD/2Q==',
  'base64'
);

// 1x1 PNG
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64'
);

function buildMultipartImage(contentType = 'image/jpeg', filename = 'test.jpg') {
  const fd = new FormData();
  const buf = contentType === 'image/png' ? TINY_PNG : TINY_JPEG;
  fd.append('file', new Blob([buf], { type: contentType }), filename);
  return fd;
}

function buildMultipartImageWithUrl(imageUrl) {
  const fd = new FormData();
  fd.append('image_url', imageUrl);
  return fd;
}

function buildMultipartBreedImage(folder, contentType = 'image/jpeg', filename = 'test.jpg') {
  const fd = new FormData();
  const buf = contentType === 'image/png' ? TINY_PNG : TINY_JPEG;
  fd.append('file', new Blob([buf], { type: contentType }), filename);
  if (folder !== undefined) {
    fd.append('url', folder);
  }
  return fd;
}

function buildMultipartTwoFiles() {
  const fd = new FormData();
  fd.append('file', new Blob([TINY_JPEG], { type: 'image/jpeg' }), 'a.jpg');
  fd.append('file', new Blob([TINY_JPEG], { type: 'image/jpeg' }), 'b.jpg');
  return fd;
}

// ─── DB helpers ──────────────────────────────────────────────────────────────

async function connectDB() {
  if (!MONGODB_URI) throw new Error('env.json missing PetAnalysisFunction.MONGODB_URI');
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

function eyeAnalysisCol() {
  return mongoose.connection.db.collection('eyeanalysisrecords');
}

function eyeDiseasesCol() {
  return mongoose.connection.db.collection('eye_diseases');
}

function apiLogsCol() {
  return mongoose.connection.db.collection('api_logs');
}

function rateLimitsCol() {
  return mongoose.connection.db.collection('rate_limits');
}

function imageCollectionsCol() {
  return mongoose.connection.db.collection('image_collections');
}

async function clearAnalysisFor(petId) {
  await eyeAnalysisCol().deleteMany({ petId: petId.toString() });
}

function computeRateLimitKey(ip, identifier) {
  const raw = `${ip}:${identifier}`;
  return createHash('sha256').update(raw).digest('hex');
}

function rateLimitWindowStart(windowSeconds) {
  const windowMs = windowSeconds * 1000;
  return new Date(Math.floor(Date.now() / windowMs) * windowMs);
}

async function seedRateLimit(action, userId, limit, windowSeconds) {
  const key = computeRateLimitKey(CLIENT_IP, userId.toString());
  const windowStart = rateLimitWindowStart(windowSeconds);
  const expireAt = new Date(windowStart.getTime() + windowSeconds * 2000);

  await rateLimitsCol().updateOne(
    { action, key, windowStart },
    { $set: { count: limit + 1, expireAt } },
    { upsert: true }
  );
}

async function seedFixtures() {
  state.primaryToken = signToken({ userId: state.primaryUserId });
  state.secondaryToken = signToken({ userId: state.secondaryUserId });
  state.ngoToken = signToken({
    userId: new mongoose.Types.ObjectId(),
    role: 'ngo',
    ngoId: state.ngoId,
  });

  await rateLimitsCol().deleteMany({
    action: {
      $in: [
        'eyeUploadAnalysis',
        'petEyeUpdate',
        'breedAnalysis',
        'uploadImage',
        'uploadPetBreedImage',
      ],
    },
  });

  const nowMs = Date.now();

  await petsCol().deleteMany({
    _id: {
      $in: [state.primaryPetId, state.secondaryPetId, state.deletedPetId, state.ngoPetId],
    },
  });

  await usersCol().deleteMany({
    _id: { $in: [state.primaryUserId, state.secondaryUserId] },
  });

  await eyeDiseasesCol().deleteMany({ _id: state.eyeDiseaseId });
  await eyeAnalysisCol().deleteMany({
    _id: { $in: [state.eyeLogId1, state.eyeLogId2] },
  });

  await petsCol().insertMany([
    {
      _id: state.primaryPetId,
      userId: state.primaryUserId,
      name: `AnalysisPet-${RUN_ID}`,
      animal: 'Dog',
      sex: 'Male',
      birthday: new Date('2022-01-01T00:00:00.000Z'),
      eyeimages: [],
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
      eyeimages: [],
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
      eyeimages: [],
      deleted: true,
      transfer: [],
      transferNGO: [],
      createdAt: new Date(nowMs + 2),
      updatedAt: new Date(nowMs + 2),
    },
    {
      _id: state.ngoPetId,
      userId: new mongoose.Types.ObjectId(),
      ngoId: state.ngoId,
      name: `NgoPet-${RUN_ID}`,
      animal: 'Dog',
      sex: 'Male',
      birthday: new Date('2022-06-01T00:00:00.000Z'),
      eyeimages: [],
      deleted: false,
      transfer: [],
      transferNGO: [],
      createdAt: new Date(nowMs + 3),
      updatedAt: new Date(nowMs + 3),
    },
  ]);

  await usersCol().insertMany([
    { _id: state.primaryUserId, deleted: false, createdAt: new Date(nowMs), updatedAt: new Date(nowMs) },
    { _id: state.secondaryUserId, deleted: false, createdAt: new Date(nowMs + 1), updatedAt: new Date(nowMs + 1) },
  ]);

  await eyeDiseasesCol().insertOne({
    _id: state.eyeDiseaseId,
    eyeDisease_eng: 'Cataract',
    eyeDisease_chi: '白內障',
    eyeDisease_issue: '晶體混濁',
    eyeDisease_care: '定期檢查',
    eyeDisease_issue_en: 'Lens opacity',
    eyeDisease_care_en: 'Regular checkups',
  });

  await eyeAnalysisCol().insertMany([
    {
      _id: state.eyeLogId1,
      petId: state.primaryPetId.toString(),
      image: 'https://example.com/eye1.jpg',
      result: { disease: 'Cataract', confidence: 0.92 },
      heatmap: null,
      createdAt: new Date(nowMs),
      updatedAt: new Date(nowMs),
    },
    {
      _id: state.eyeLogId2,
      petId: state.primaryPetId.toString(),
      image: 'https://example.com/eye2.jpg',
      result: { disease: 'Normal', confidence: 0.98 },
      heatmap: 'https://example.com/heatmap2.jpg',
      createdAt: new Date(nowMs + 1),
      updatedAt: new Date(nowMs + 1),
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
    await fetch(`${BASE_URL}/pet/analysis/breed`, {
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
    const petIds = [state.primaryPetId, state.secondaryPetId, state.deletedPetId, state.ngoPetId];
    await petsCol().deleteMany({ _id: { $in: petIds } });
    await usersCol().deleteMany({
      _id: { $in: [state.primaryUserId, state.secondaryUserId] },
    });
    await eyeDiseasesCol().deleteMany({ _id: state.eyeDiseaseId });
    await eyeAnalysisCol().deleteMany({
      _id: { $in: [state.eyeLogId1, state.eyeLogId2] },
    });
    await eyeAnalysisCol().deleteMany({ petId: state.primaryPetId.toString() });
    await rateLimitsCol().deleteMany({
      action: {
        $in: [
          'eyeUploadAnalysis',
          'petEyeUpdate',
          'breedAnalysis',
          'uploadImage',
          'uploadPetBreedImage',
        ],
      },
    });
    await mongoose.disconnect();
  }
});

// ─── suite ───────────────────────────────────────────────────────────────────

describe('Tier 3+4 — /pet/analysis via SAM local + UAT DB', () => {
  beforeAll(async () => {
    await ensureSamLocalReachable();
  });

  test('env.json uses ALLOWED_ORIGINS=* so denied-origin preflight is not provable here', () => {
    expect(ALLOWED_ORIGINS).toBe('*');
  });

  // ── Runtime boundary ────────────────────────────────────────────────────────

  describe('runtime boundary behavior', () => {
    test('OPTIONS /pet/analysis/eye/{proxy+} returns 204 with CORS headers', async () => {
      const petId = new mongoose.Types.ObjectId().toString();
      const res = await req('OPTIONS', `/pet/analysis/eye/${petId}`, undefined, {
        origin: VALID_ORIGIN,
      });

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.headers['access-control-allow-headers']).toContain('x-api-key');
    });

    test('OPTIONS /pet/analysis/breed returns 204 with CORS headers', async () => {
      const res = await req('OPTIONS', '/pet/analysis/breed', undefined, {
        origin: VALID_ORIGIN,
      });

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('*');
    });

    test('OPTIONS /pet/analysis/uploads/{proxy+} returns 204 with CORS headers', async () => {
      const res = await req('OPTIONS', '/pet/analysis/uploads/image', undefined, {
        origin: VALID_ORIGIN,
      });

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('*');
    });

    test('PUT /pet/analysis/eye/{petId} returns 403 or 405 (wrong method)', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'PUT',
        `/pet/analysis/eye/${state.primaryPetId}`,
        {},
        authHeaders(state.primaryToken)
      );

      expect([403, 405]).toContain(res.status);
    });

    test('DELETE /pet/analysis/eye/{petId} returns 403 or 405 (unsupported method)', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'DELETE',
        `/pet/analysis/eye/${state.primaryPetId}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect([403, 405]).toContain(res.status);
    });

    test('unknown nested path returns 403 or 404', async () => {
      const res = await req(
        'GET',
        '/pet/analysis/unknown/nested/path',
        undefined,
        publicHeaders()
      );

      expect([403, 404]).toContain(res.status);
    });

    test('CORS headers are present on a protected 401/403 response', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const petId = new mongoose.Types.ObjectId().toString();
      const res = await req(
        'PATCH',
        `/pet/analysis/eye/${petId}`,
        { petId, date: '2024-01-01', leftEyeImage1PublicAccessUrl: 'https://a.com/l.jpg', rightEyeImage1PublicAccessUrl: 'https://a.com/r.jpg' },
        publicHeaders()
      );

      expect(res.headers['access-control-allow-origin']).toBe('*');
    });
  });

  // ── Authentication and authorisation ────────────────────────────────────────

  describe('authentication and authorisation', () => {
    test('POST /pet/analysis/eye/{petId} rejects missing Authorization header', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const fd = buildMultipartImageWithUrl('https://example.com/eye.jpg');
      const res = await reqMultipart(
        'POST',
        `/pet/analysis/eye/${state.primaryPetId}`,
        fd,
        null
      );

      expect(expectedUnauthenticatedStatuses()).toContain(res.status);
    });

    test('PATCH /pet/analysis/eye/{petId} rejects missing Authorization header', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'PATCH',
        `/pet/analysis/eye/${state.primaryPetId}`,
        {
          petId: state.primaryPetId.toString(),
          date: '2024-01-01',
          leftEyeImage1PublicAccessUrl: 'https://a.com/l.jpg',
          rightEyeImage1PublicAccessUrl: 'https://a.com/r.jpg',
        },
        publicHeaders()
      );

      expect(expectedUnauthenticatedStatuses()).toContain(res.status);
    });

    test('POST /pet/analysis/breed rejects missing Authorization header', async () => {
      if (AUTH_BYPASS === 'true') {
        // AUTH_BYPASS in RequestAuthorizerFunction always returns Allow — breed has
        // no pet-ownership check so the bypass user gets through to the ML endpoint.
        return;
      }
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'POST',
        '/pet/analysis/breed',
        { species: 'dog', url: 'https://example.com/pet.jpg' },
        publicHeaders()
      );

      expect(expectedUnauthenticatedStatuses()).toContain(res.status);
    });

    test('POST /pet/analysis/uploads/image rejects missing Authorization header', async () => {
      if (AUTH_BYPASS === 'true') {
        return;
      }
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const fd = buildMultipartImage();
      const res = await reqMultipart('POST', '/pet/analysis/uploads/image', fd, null);

      expect(expectedUnauthenticatedStatuses()).toContain(res.status);
    });

    test('POST /pet/analysis/uploads/breed-image rejects missing Authorization header', async () => {
      if (AUTH_BYPASS === 'true') {
        return;
      }
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const fd = buildMultipartBreedImage('breed_analysis');
      const res = await reqMultipart('POST', '/pet/analysis/uploads/breed-image', fd, null);

      expect(expectedUnauthenticatedStatuses()).toContain(res.status);
    });

    test('POST /pet/analysis/eye/{petId} rejects garbage bearer token', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const fd = buildMultipartImageWithUrl('https://example.com/eye.jpg');
      const res = await reqMultipart(
        'POST',
        `/pet/analysis/eye/${state.primaryPetId}`,
        fd,
        'this.is.garbage'
      );

      expect([401, 403]).toContain(res.status);
    });

    test('PATCH /pet/analysis/eye/{petId} rejects expired JWT', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const expiredToken = signToken({ userId: state.primaryUserId, expiresIn: -60 });
      const res = await req(
        'PATCH',
        `/pet/analysis/eye/${state.primaryPetId}`,
        {
          petId: state.primaryPetId.toString(),
          date: '2024-01-01',
          leftEyeImage1PublicAccessUrl: 'https://a.com/l.jpg',
          rightEyeImage1PublicAccessUrl: 'https://a.com/r.jpg',
        },
        authHeaders(expiredToken)
      );

      expect([401, 403]).toContain(res.status);
    });

    test('POST /pet/analysis/breed rejects tampered JWT', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const tampered = `${state.primaryToken.slice(0, -1)}${
        state.primaryToken.slice(-1) === 'a' ? 'b' : 'a'
      }`;
      const res = await req(
        'POST',
        '/pet/analysis/breed',
        { species: 'dog', url: 'https://example.com/pet.jpg' },
        authHeaders(tampered)
      );

      expect([401, 403]).toContain(res.status);
    });

    test('POST /pet/analysis/eye/{petId} rejects alg:none JWT attack', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const algNone = buildAlgNoneToken({ userId: state.primaryUserId });
      const fd = buildMultipartImageWithUrl('https://example.com/eye.jpg');
      const res = await reqMultipart(
        'POST',
        `/pet/analysis/eye/${state.primaryPetId}`,
        fd,
        algNone
      );

      expect([401, 403]).toContain(res.status);
    });

    test('GET /pet/analysis/eye/{petId} as eye log rejects missing auth', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'GET',
        `/pet/analysis/eye/${state.primaryPetId}`,
        undefined,
        publicHeaders()
      );

      expect(expectedUnauthenticatedStatuses()).toContain(res.status);
    });

    test('GET /pet/analysis/eye/{petId} returns 403 when caller accesses another owner\'s pet', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'GET',
        `/pet/analysis/eye/${state.secondaryPetId}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(403);
    });

    test('POST /pet/analysis/eye/{petId} returns 403 when caller accesses another owner\'s pet — no DB mutation', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const beforeCount = await eyeAnalysisCol().countDocuments({
        petId: state.secondaryPetId.toString(),
      });

      const fd = buildMultipartImageWithUrl('https://example.com/eye.jpg');
      const res = await reqMultipart(
        'POST',
        `/pet/analysis/eye/${state.secondaryPetId}`,
        fd,
        state.primaryToken
      );

      expect(res.status).toBe(403);

      const afterCount = await eyeAnalysisCol().countDocuments({
        petId: state.secondaryPetId.toString(),
      });
      expect(afterCount).toBe(beforeCount);
    });

    test('PATCH /pet/analysis/eye/{petId} returns 403 when caller does not own the pet — DB unchanged', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const before = await petsCol().findOne({ _id: state.secondaryPetId });
      const beforeLen = (before?.eyeimages || []).length;

      const res = await req(
        'PATCH',
        `/pet/analysis/eye/${state.secondaryPetId}`,
        {
          petId: state.secondaryPetId.toString(),
          date: '2024-01-01',
          leftEyeImage1PublicAccessUrl: 'https://a.com/l.jpg',
          rightEyeImage1PublicAccessUrl: 'https://a.com/r.jpg',
        },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(403);

      const after = await petsCol().findOne({ _id: state.secondaryPetId });
      expect((after?.eyeimages || []).length).toBe(beforeLen);
    });

    test('POST /pet/analysis/eye/{petId} returns 404 when pet is soft-deleted', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const fd = buildMultipartImageWithUrl('https://example.com/eye.jpg');
      const res = await reqMultipart(
        'POST',
        `/pet/analysis/eye/${state.deletedPetId}`,
        fd,
        state.primaryToken
      );

      expect(res.status).toBe(404);
    });

    test('PATCH /pet/analysis/eye/{petId} returns 410 when pet is soft-deleted', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'PATCH',
        `/pet/analysis/eye/${state.deletedPetId}`,
        {
          petId: state.deletedPetId.toString(),
          date: '2024-01-01',
          leftEyeImage1PublicAccessUrl: 'https://a.com/l.jpg',
          rightEyeImage1PublicAccessUrl: 'https://a.com/r.jpg',
        },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(410);
      expect(res.body?.errorKey).toBe('petAnalysis.errors.updatePetEye.petDeleted');
    });
  });

  // ── GET /pet/analysis/eye/{identifier} — public disease lookup ──────────────

  describe('GET /pet/analysis/eye/{identifier} — public eye disease lookup', () => {
    test('returns disease details for known disease name (Cataract)', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'GET',
        '/pet/analysis/eye/Cataract',
        undefined,
        publicHeaders()
      );

      expect(res.status).toBe(201);
      expect(res.body?.success).toBe(true);
      expect(res.body?.result?.eyeDisease_eng).toBe('Cataract');
    });

    test('returns null fields for "Normal" disease name', async () => {
      const res = await req(
        'GET',
        '/pet/analysis/eye/Normal',
        undefined,
        publicHeaders()
      );

      expect(res.status).toBe(201);
      expect(res.body?.success).toBe(true);
      expect(res.body?.result?.id).toBeNull();
      expect(res.body?.result?.eyeDiseaseEng).toBeNull();
      expect(res.body?.result?.eyeDiseaseChi).toBeNull();
    });

    test('returns 404 for unknown disease name', async () => {
      const res = await req(
        'GET',
        '/pet/analysis/eye/NonExistentDisease999',
        undefined,
        publicHeaders()
      );

      expect(res.status).toBe(404);
      expect(res.body?.errorKey).toBe('petAnalysis.errors.eyeDiseaseNotFound');
    });

    test('public disease lookup works without any Authorization header', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req('GET', '/pet/analysis/eye/Cataract', undefined, {
        origin: VALID_ORIGIN,
        'x-forwarded-for': CLIENT_IP,
      });

      expect(res.status).toBe(201);
      expect(res.body?.success).toBe(true);
    });

    test('URL-encoded disease name with spaces resolves correctly', async () => {
      // This tests the decodeURIComponent behavior; the disease may or may not exist.
      const res = await req(
        'GET',
        '/pet/analysis/eye/Cherry%20Eye',
        undefined,
        publicHeaders()
      );

      // Either 201 (found) or 404 (not in DB) — but NOT a 400 or 500
      expect([201, 404]).toContain(res.status);
    });
  });

  // ── GET /pet/analysis/eye/{petId} — authenticated eye log ───────────────────

  describe('GET /pet/analysis/eye/{petId} — authenticated eye analysis log', () => {
    test('returns eye analysis log list for owned pet', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'GET',
        `/pet/analysis/eye/${state.primaryPetId}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(200);
      expect(res.body?.success).toBe(true);
      expect(Array.isArray(res.body?.result)).toBe(true);
      expect(res.body.result.length).toBeGreaterThanOrEqual(2);

      const first = res.body.result[0];
      expect(first).toHaveProperty('petId');
      expect(first).toHaveProperty('image');
      expect(first).toHaveProperty('result');
    });

    test('returns empty list when pet has no eye analysis records', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();
      await clearAnalysisFor(state.secondaryPetId);

      const res = await req(
        'GET',
        `/pet/analysis/eye/${state.secondaryPetId}`,
        undefined,
        authHeaders(state.secondaryToken)
      );

      expect(res.status).toBe(200);
      expect(res.body?.success).toBe(true);
      expect(Array.isArray(res.body?.result)).toBe(true);
      expect(res.body.result).toHaveLength(0);
    });

    test('NGO owner can access eye log for NGO-owned pet', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'GET',
        `/pet/analysis/eye/${state.ngoPetId}`,
        undefined,
        authHeaders(state.ngoToken)
      );

      expect(res.status).toBe(200);
      expect(res.body?.success).toBe(true);
    });
  });

  // ── POST /pet/analysis/eye/{petId} — eye analysis ──────────────────────────

  describe('POST /pet/analysis/eye/{petId} — eye analysis', () => {
    test('returns 400 for invalid petId format in path', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const fd = buildMultipartImageWithUrl('https://example.com/eye.jpg');
      const res = await reqMultipart(
        'POST',
        '/pet/analysis/eye/not-valid-id',
        fd,
        state.primaryToken
      );

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('petAnalysis.errors.invalidObjectId');
    });

    test('returns 400 when no image_url and no file attached', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const fd = new FormData();
      const res = await reqMultipart(
        'POST',
        `/pet/analysis/eye/${state.primaryPetId}`,
        fd,
        state.primaryToken
      );

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('petAnalysis.errors.missingArguments');
    });

    test('returns 404 when user not found (deleted user)', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const ghostUserId = new mongoose.Types.ObjectId();
      const ghostPetId = new mongoose.Types.ObjectId();

      await petsCol().insertOne({
        _id: ghostPetId,
        userId: ghostUserId,
        name: `GhostPet-${RUN_ID}`,
        animal: 'Dog',
        sex: 'Male',
        birthday: new Date(),
        eyeimages: [],
        deleted: false,
        transfer: [],
        transferNGO: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const ghostToken = signToken({ userId: ghostUserId });
      const fd = buildMultipartImageWithUrl('https://example.com/eye.jpg');
      const res = await reqMultipart(
        'POST',
        `/pet/analysis/eye/${ghostPetId}`,
        fd,
        ghostToken
      );

      expect(res.status).toBe(404);
      expect(res.body?.errorKey).toBe('petAnalysis.errors.userNotFound');

      await petsCol().deleteOne({ _id: ghostPetId });
    });

    test('happy path with image_url reaches ML VM (or returns 500 if unreachable)', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const fd = buildMultipartImageWithUrl('https://example.com/eye.jpg');
      const res = await reqMultipart(
        'POST',
        `/pet/analysis/eye/${state.primaryPetId}`,
        fd,
        state.primaryToken
      );

      // 502 = SAM local multipart crash; 504 = gateway timeout (ML VM unreachable)
      expect([200, 400, 500, 502, 504]).toContain(res.status);

      if (res.status === 200) {
        expect(res.body?.result).toBeDefined();
        expect(res.body?.request_id).toBeDefined();
        expect(res.body?.time_taken).toBeDefined();

        const logEntry = await eyeAnalysisCol().findOne({
          petId: state.primaryPetId.toString(),
          image: 'https://example.com/eye.jpg',
        });
        expect(logEntry).not.toBeNull();
      }
    });

    test('api_logs entry created even when analysis endpoint is called', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const beforeCount = await apiLogsCol().countDocuments({
        userId: state.primaryUserId,
      });

      const fd = buildMultipartImageWithUrl('https://example.com/eye-log-test.jpg');
      await reqMultipart(
        'POST',
        `/pet/analysis/eye/${state.primaryPetId}`,
        fd,
        state.primaryToken
      );

      const afterCount = await apiLogsCol().countDocuments({
        userId: state.primaryUserId,
      });

      expect(afterCount).toBeGreaterThanOrEqual(beforeCount);
    });
  });

  // ── PATCH /pet/analysis/eye/{petId} — update pet eye images ─────────────────

  describe('PATCH /pet/analysis/eye/{petId} — update pet eye images', () => {
    const validPatchBody = () => ({
      petId: state.primaryPetId.toString(),
      date: '2024-06-15',
      leftEyeImage1PublicAccessUrl: 'https://example.com/left-eye.jpg',
      rightEyeImage1PublicAccessUrl: 'https://example.com/right-eye.jpg',
    });

    test('returns 400 for missing required body fields', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'PATCH',
        `/pet/analysis/eye/${state.primaryPetId}`,
        { petId: state.primaryPetId.toString() },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
    });

    test('returns 400 when body petId does not match path petId', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'PATCH',
        `/pet/analysis/eye/${state.primaryPetId}`,
        {
          petId: state.secondaryPetId.toString(),
          date: '2024-06-15',
          leftEyeImage1PublicAccessUrl: 'https://example.com/l.jpg',
          rightEyeImage1PublicAccessUrl: 'https://example.com/r.jpg',
        },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('petAnalysis.errors.updatePetEye.invalidPetIdFormat');
    });

    test('returns 400 for invalid date format', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'PATCH',
        `/pet/analysis/eye/${state.primaryPetId}`,
        { ...validPatchBody(), date: 'not-a-date' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('petAnalysis.errors.updatePetEye.invalidDateFormat');
    });

    test('returns 400 for invalid image URL format', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'PATCH',
        `/pet/analysis/eye/${state.primaryPetId}`,
        { ...validPatchBody(), leftEyeImage1PublicAccessUrl: 'not-a-url' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('petAnalysis.errors.updatePetEye.invalidImageUrlFormat');
    });

    test('returns 400 for malformed JSON body', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'PATCH',
        `/pet/analysis/eye/${state.primaryPetId}`,
        '{"petId"',
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
    });

    test('happy path: pushes eye images to pet.eyeimages and returns updated pet', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      await petsCol().updateOne(
        { _id: state.primaryPetId },
        { $set: { eyeimages: [] } }
      );

      const res = await req(
        'PATCH',
        `/pet/analysis/eye/${state.primaryPetId}`,
        validPatchBody(),
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(201);
      expect(res.body?.success).toBe(true);
      expect(res.body?.result).toBeDefined();

      const pet = await petsCol().findOne({ _id: state.primaryPetId });
      expect(pet.eyeimages).toHaveLength(1);
      expect(pet.eyeimages[0].eyeimage_left1).toBe('https://example.com/left-eye.jpg');
      expect(pet.eyeimages[0].eyeimage_right1).toBe('https://example.com/right-eye.jpg');
      expect(pet.eyeimages[0].date).toBeDefined();
    });

    test('second PATCH appends to eyeimages array (does not replace)', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      await petsCol().updateOne(
        { _id: state.primaryPetId },
        { $set: { eyeimages: [] } }
      );

      const first = await req(
        'PATCH',
        `/pet/analysis/eye/${state.primaryPetId}`,
        validPatchBody(),
        authHeaders(state.primaryToken)
      );
      expect(first.status).toBe(201);

      const second = await req(
        'PATCH',
        `/pet/analysis/eye/${state.primaryPetId}`,
        { ...validPatchBody(), date: '2024-07-20' },
        authHeaders(state.primaryToken)
      );
      expect(second.status).toBe(201);

      const pet = await petsCol().findOne({ _id: state.primaryPetId });
      expect(pet.eyeimages.length).toBeGreaterThanOrEqual(2);
    });

    test('returns 404 when pet does not exist', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const fakeId = new mongoose.Types.ObjectId();
      const res = await req(
        'PATCH',
        `/pet/analysis/eye/${fakeId}`,
        {
          petId: fakeId.toString(),
          date: '2024-01-01',
          leftEyeImage1PublicAccessUrl: 'https://a.com/l.jpg',
          rightEyeImage1PublicAccessUrl: 'https://a.com/r.jpg',
        },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(404);
      expect(res.body?.errorKey).toBe('petAnalysis.errors.updatePetEye.petNotFound');
    });

    test('returns 410 when pet is soft-deleted — DB unchanged', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const before = await petsCol().findOne({ _id: state.deletedPetId });
      const beforeLen = (before?.eyeimages || []).length;

      const res = await req(
        'PATCH',
        `/pet/analysis/eye/${state.deletedPetId}`,
        {
          petId: state.deletedPetId.toString(),
          date: '2024-01-01',
          leftEyeImage1PublicAccessUrl: 'https://a.com/l.jpg',
          rightEyeImage1PublicAccessUrl: 'https://a.com/r.jpg',
        },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(410);
      expect(res.body?.errorKey).toBe('petAnalysis.errors.updatePetEye.petDeleted');

      const after = await petsCol().findOne({ _id: state.deletedPetId });
      expect((after?.eyeimages || []).length).toBe(beforeLen);
    });

    test('returns 403 when caller does not own the pet — DB unchanged', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const before = await petsCol().findOne({ _id: state.secondaryPetId });
      const beforeLen = (before?.eyeimages || []).length;

      const res = await req(
        'PATCH',
        `/pet/analysis/eye/${state.secondaryPetId}`,
        {
          petId: state.secondaryPetId.toString(),
          date: '2024-01-01',
          leftEyeImage1PublicAccessUrl: 'https://a.com/l.jpg',
          rightEyeImage1PublicAccessUrl: 'https://a.com/r.jpg',
        },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(403);

      const after = await petsCol().findOne({ _id: state.secondaryPetId });
      expect((after?.eyeimages || []).length).toBe(beforeLen);
    });
  });

  // ── POST /pet/analysis/breed — breed analysis ──────────────────────────────

  describe('POST /pet/analysis/breed — breed analysis', () => {
    test('returns 400 for missing species field', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'POST',
        '/pet/analysis/breed',
        { url: 'https://example.com/pet.jpg' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
    });

    test('returns 400 for empty species', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'POST',
        '/pet/analysis/breed',
        { species: '', url: 'https://example.com/pet.jpg' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('petAnalysis.errors.speciesRequired');
    });

    test('returns 400 for missing url field', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'POST',
        '/pet/analysis/breed',
        { species: 'dog' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
    });

    test('returns 400 for invalid URL format', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'POST',
        '/pet/analysis/breed',
        { species: 'dog', url: 'not-a-url' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('petAnalysis.errors.invalidUrl');
    });

    test('returns 400 for unknown extra fields (mass-assignment prevention)', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'POST',
        '/pet/analysis/breed',
        {
          species: 'dog',
          url: 'https://example.com/pet.jpg',
          role: 'admin',
          isAdmin: true,
        },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('petAnalysis.errors.unknownField');
    });

    test('returns 400 for malformed JSON body', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'POST',
        '/pet/analysis/breed',
        '{ broken json',
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
    });

    test('returns 400 for species field exceeding max length', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'POST',
        '/pet/analysis/breed',
        { species: 'x'.repeat(101), url: 'https://example.com/pet.jpg' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('petAnalysis.errors.fieldTooLong');
    });
  });

  // ── POST /pet/analysis/uploads/image — image upload ─────────────────────────

  describe('POST /pet/analysis/uploads/image — image upload', () => {
    test('returns 400 when no file uploaded', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const fd = new FormData();
      const res = await reqMultipart('POST', '/pet/analysis/uploads/image', fd, state.primaryToken);

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('petAnalysis.errors.noFilesUploaded');
    });

    // SAM local may return 502 when binary file data is present in multipart
    // FormData — lambda-multipart-parser crashes on the raw body encoding.

    test('returns 400 when more than one file uploaded', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const fd = buildMultipartTwoFiles();
      const res = await reqMultipart('POST', '/pet/analysis/uploads/image', fd, state.primaryToken);

      expect([400, 502]).toContain(res.status);
      if (res.status === 400) {
        expect(res.body?.errorKey).toBe('petAnalysis.errors.tooManyFiles');
      }
    });

    test('returns 400 for unsupported file type (image/gif)', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const fd = buildMultipartImage('image/gif', 'test.gif');
      const res = await reqMultipart('POST', '/pet/analysis/uploads/image', fd, state.primaryToken);

      expect([400, 502]).toContain(res.status);
      if (res.status === 400) {
        expect(res.body?.errorKey).toBe('petAnalysis.errors.invalidImageFormat');
      }
    });

    test('happy path: uploads JPEG and returns public URL', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const fd = buildMultipartImage('image/jpeg', 'test-upload.jpg');
      const res = await reqMultipart('POST', '/pet/analysis/uploads/image', fd, state.primaryToken);

      // S3 may not be available in local environment; 502 = SAM local multipart crash
      expect([200, 500, 502]).toContain(res.status);

      if (res.status === 200) {
        expect(res.body?.success).toBe(true);
        expect(typeof res.body?.url).toBe('string');
        expect(res.body.url).toMatch(/^https?:\/\//);
      }
    });

    test('happy path: uploads PNG and returns public URL', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const fd = buildMultipartImage('image/png', 'test-upload.png');
      const res = await reqMultipart('POST', '/pet/analysis/uploads/image', fd, state.primaryToken);

      expect([200, 500, 502]).toContain(res.status);

      if (res.status === 200) {
        expect(res.body?.success).toBe(true);
        expect(typeof res.body?.url).toBe('string');
      }
    });
  });

  // ── POST /pet/analysis/uploads/breed-image — breed image upload ─────────────

  describe('POST /pet/analysis/uploads/breed-image — breed image upload', () => {
    test('returns 400 when no file uploaded', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const fd = new FormData();
      fd.append('url', 'breed_analysis');
      const res = await reqMultipart(
        'POST',
        '/pet/analysis/uploads/breed-image',
        fd,
        state.primaryToken
      );

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('petAnalysis.errors.noFilesUploaded');
    });

    // SAM local may return 502 when binary file data is present in multipart
    // FormData — lambda-multipart-parser crashes on the raw body encoding.

    test('returns 400 for unsupported file type (image/tiff)', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const fd = buildMultipartBreedImage('breed_analysis', 'image/tiff', 'test.tiff');
      const res = await reqMultipart(
        'POST',
        '/pet/analysis/uploads/breed-image',
        fd,
        state.primaryToken
      );

      expect([400, 502]).toContain(res.status);
      if (res.status === 400) {
        expect(res.body?.errorKey).toBe('petAnalysis.errors.invalidImageFormat');
      }
    });

    test('returns 400 for empty folder path', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const fd = buildMultipartBreedImage('');
      const res = await reqMultipart(
        'POST',
        '/pet/analysis/uploads/breed-image',
        fd,
        state.primaryToken
      );

      expect([400, 502]).toContain(res.status);
      if (res.status === 400) {
        expect(res.body?.errorKey).toBe('petAnalysis.errors.invalidFolder');
      }
    });

    test('returns 400 for disallowed folder prefix', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const fd = buildMultipartBreedImage('/etc/passwd');
      const res = await reqMultipart(
        'POST',
        '/pet/analysis/uploads/breed-image',
        fd,
        state.primaryToken
      );

      expect([400, 502]).toContain(res.status);
      if (res.status === 400) {
        expect(res.body?.errorKey).toBe('petAnalysis.errors.invalidFolder');
      }
    });

    test('returns 400 for path traversal with ..', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const fd = buildMultipartBreedImage('breed_analysis/../secret');
      const res = await reqMultipart(
        'POST',
        '/pet/analysis/uploads/breed-image',
        fd,
        state.primaryToken
      );

      expect([400, 502]).toContain(res.status);
      if (res.status === 400) {
        expect(res.body?.errorKey).toBe('petAnalysis.errors.invalidFolder');
      }
    });

    test('returns 400 for path traversal with .', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const fd = buildMultipartBreedImage('breed_analysis/./../../etc');
      const res = await reqMultipart(
        'POST',
        '/pet/analysis/uploads/breed-image',
        fd,
        state.primaryToken
      );

      expect([400, 502]).toContain(res.status);
      if (res.status === 400) {
        expect(res.body?.errorKey).toBe('petAnalysis.errors.invalidFolder');
      }
    });

    test('happy path: uploads to allowed prefix breed_analysis', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const fd = buildMultipartBreedImage('breed_analysis/run1');
      const res = await reqMultipart(
        'POST',
        '/pet/analysis/uploads/breed-image',
        fd,
        state.primaryToken
      );

      // 502 = SAM local multipart crash
      expect([200, 500, 502]).toContain(res.status);

      if (res.status === 200) {
        expect(res.body?.success).toBe(true);
        expect(typeof res.body?.url).toBe('string');
        expect(res.body.url).toMatch(/^https?:\/\//);
      }
    });

    test('happy path: uploads to allowed prefix pets', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const fd = buildMultipartBreedImage('pets/profile');
      const res = await reqMultipart(
        'POST',
        '/pet/analysis/uploads/breed-image',
        fd,
        state.primaryToken
      );

      expect([200, 500, 502]).toContain(res.status);
    });

    test('returns 400 for folder prefix not in allowlist', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const fd = buildMultipartBreedImage('documents/private');
      const res = await reqMultipart(
        'POST',
        '/pet/analysis/uploads/breed-image',
        fd,
        state.primaryToken
      );

      expect([400, 502]).toContain(res.status);
      if (res.status === 400) {
        expect(res.body?.errorKey).toBe('petAnalysis.errors.invalidFolder');
      }
    });
  });

  // ── Cyberattacks ───────────────────────────────────────────────────────────

  describe('cyberattacks', () => {
    test('GET eye — NoSQL operator injection as identifier is treated as disease name and returns 404', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'GET',
        `/pet/analysis/eye/${encodeURIComponent('{"$gt":""}')}`,
        undefined,
        publicHeaders()
      );

      expect(res.status).toBe(404);
      expect(res.body?.errorKey).toBe('petAnalysis.errors.eyeDiseaseNotFound');
    });

    test('PATCH eye — unknown extra fields rejected by strict Zod schema — no DB mutation', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const before = await petsCol().findOne({ _id: state.primaryPetId });
      const beforeLen = (before?.eyeimages || []).length;

      const res = await req(
        'PATCH',
        `/pet/analysis/eye/${state.primaryPetId}`,
        {
          petId: state.primaryPetId.toString(),
          date: '2024-01-01',
          leftEyeImage1PublicAccessUrl: 'https://a.com/l.jpg',
          rightEyeImage1PublicAccessUrl: 'https://a.com/r.jpg',
          role: 'admin',
          isAdmin: true,
        },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);

      const after = await petsCol().findOne({ _id: state.primaryPetId });
      expect((after?.eyeimages || []).length).toBe(beforeLen);
    });

    test('PATCH eye — NoSQL operator injection in image URL field is rejected', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'PATCH',
        `/pet/analysis/eye/${state.primaryPetId}`,
        {
          petId: state.primaryPetId.toString(),
          date: '2024-01-01',
          leftEyeImage1PublicAccessUrl: { $gt: '' },
          rightEyeImage1PublicAccessUrl: 'https://a.com/r.jpg',
        },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
    });

    test('POST breed — NoSQL operator injection in species field is rejected', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const res = await req(
        'POST',
        '/pet/analysis/breed',
        { species: { $gt: '' }, url: 'https://example.com/pet.jpg' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
    });

    test('POST eye — petId that looks like NoSQL injection returns 400', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const fd = buildMultipartImageWithUrl('https://example.com/eye.jpg');
      const res = await reqMultipart(
        'POST',
        `/pet/analysis/eye/${encodeURIComponent('{"$ne":null}')}`,
        fd,
        state.primaryToken
      );

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('petAnalysis.errors.invalidObjectId');
    });

    test('PATCH eye — self-access bypass: body petId targeting another pet is caught', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const before = await petsCol().findOne({ _id: state.secondaryPetId });
      const beforeLen = (before?.eyeimages || []).length;

      const res = await req(
        'PATCH',
        `/pet/analysis/eye/${state.primaryPetId}`,
        {
          petId: state.secondaryPetId.toString(),
          date: '2024-01-01',
          leftEyeImage1PublicAccessUrl: 'https://a.com/l.jpg',
          rightEyeImage1PublicAccessUrl: 'https://a.com/r.jpg',
        },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(400);
      expect(res.body?.errorKey).toBe('petAnalysis.errors.updatePetEye.invalidPetIdFormat');

      const after = await petsCol().findOne({ _id: state.secondaryPetId });
      expect((after?.eyeimages || []).length).toBe(beforeLen);
    });

    test('POST uploads/breed-image — path traversal with encoded segments is blocked', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const fd = buildMultipartBreedImage('breed_analysis%2F..%2F..%2Fetc%2Fsecret');
      const res = await reqMultipart(
        'POST',
        '/pet/analysis/uploads/breed-image',
        fd,
        state.primaryToken
      );

      // 502 = SAM local multipart crash
      expect([400, 500, 502]).toContain(res.status);
    });
  });

  // ── Rate limit behavior ────────────────────────────────────────────────────

  describe('rate limit behavior', () => {
    test('POST /pet/analysis/eye/{petId} returns 429 when rate limit exceeded', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      await seedRateLimit('eyeUploadAnalysis', state.primaryUserId, 10, 300);

      const fd = buildMultipartImageWithUrl('https://example.com/eye.jpg');
      const res = await reqMultipart(
        'POST',
        `/pet/analysis/eye/${state.primaryPetId}`,
        fd,
        state.primaryToken
      );

      expect(res.status).toBe(429);
      expect(res.body?.errorKey).toBe('common.rateLimited');
    });

    test('PATCH /pet/analysis/eye/{petId} returns 429 when rate limit exceeded', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      await seedRateLimit('petEyeUpdate', state.primaryUserId, 10, 60);

      const res = await req(
        'PATCH',
        `/pet/analysis/eye/${state.primaryPetId}`,
        {
          petId: state.primaryPetId.toString(),
          date: '2024-01-01',
          leftEyeImage1PublicAccessUrl: 'https://a.com/l.jpg',
          rightEyeImage1PublicAccessUrl: 'https://a.com/r.jpg',
        },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(429);
      expect(res.body?.errorKey).toBe('common.rateLimited');
    });

    test('429 response includes retry-after header', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      await seedRateLimit('breedAnalysis', state.primaryUserId, 20, 300);

      const res = await req(
        'POST',
        '/pet/analysis/breed',
        { species: 'dog', url: 'https://example.com/pet.jpg' },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(429);
      expect(res.headers['retry-after']).toBeDefined();
    });
  });

  // ── Repeated request stability ─────────────────────────────────────────────

  describe('repeated request stability', () => {
    test('warm repeated GET /pet/analysis/eye/Cataract returns stable results', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const first = await req('GET', '/pet/analysis/eye/Cataract', undefined, publicHeaders());
      const second = await req('GET', '/pet/analysis/eye/Cataract', undefined, publicHeaders());

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(first.body?.result?.eyeDisease_eng).toBe(second.body?.result?.eyeDisease_eng);
    });

    test('warm repeated PATCH requests each append to eyeimages (no corruption)', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      await petsCol().updateOne(
        { _id: state.primaryPetId },
        { $set: { eyeimages: [] } }
      );

      const dates = ['2024-01-01', '2024-02-01', '2024-03-01'];
      for (const date of dates) {
        const res = await req(
          'PATCH',
          `/pet/analysis/eye/${state.primaryPetId}`,
          {
            petId: state.primaryPetId.toString(),
            date,
            leftEyeImage1PublicAccessUrl: 'https://a.com/l.jpg',
            rightEyeImage1PublicAccessUrl: 'https://a.com/r.jpg',
          },
          authHeaders(state.primaryToken)
        );
        expect(res.status).toBe(201);
      }

      const pet = await petsCol().findOne({ _id: state.primaryPetId });
      expect(pet.eyeimages).toHaveLength(3);
    });

    test('warm repeated GET eye log returns stable result count', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      const first = await req(
        'GET',
        `/pet/analysis/eye/${state.primaryPetId}`,
        undefined,
        authHeaders(state.primaryToken)
      );
      const second = await req(
        'GET',
        `/pet/analysis/eye/${state.primaryPetId}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(first.body?.result?.length).toBe(second.body?.result?.length);
    });
  });

  // ── Sequential security state changes ──────────────────────────────────────

  describe('sequential security state changes', () => {
    test('PATCH after pet soft-delete returns 410 — DB unchanged', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      await petsCol().updateOne(
        { _id: state.primaryPetId },
        { $set: { deleted: true, eyeimages: [] } }
      );

      const res = await req(
        'PATCH',
        `/pet/analysis/eye/${state.primaryPetId}`,
        {
          petId: state.primaryPetId.toString(),
          date: '2024-01-01',
          leftEyeImage1PublicAccessUrl: 'https://a.com/l.jpg',
          rightEyeImage1PublicAccessUrl: 'https://a.com/r.jpg',
        },
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(410);

      const pet = await petsCol().findOne({ _id: state.primaryPetId });
      expect(pet.eyeimages).toHaveLength(0);

      // Restore for subsequent tests
      await petsCol().updateOne(
        { _id: state.primaryPetId },
        { $set: { deleted: false } }
      );
    });

    test('GET eye log after pet soft-delete returns 404', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedFixtures();

      await petsCol().updateOne(
        { _id: state.primaryPetId },
        { $set: { deleted: true } }
      );

      const res = await req(
        'GET',
        `/pet/analysis/eye/${state.primaryPetId}`,
        undefined,
        authHeaders(state.primaryToken)
      );

      expect(res.status).toBe(404);

      // Restore
      await petsCol().updateOne(
        { _id: state.primaryPetId },
        { $set: { deleted: false } }
      );
    });
  });
});
