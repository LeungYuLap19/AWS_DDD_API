const path = require('path');
const crypto = require('crypto');
const dns = require('dns');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const envConfig = require('../env.json');

const handlerModulePath = path.resolve(__dirname, '../dist/functions/user/index.js');
const BASE_URL = process.env.USER_UAT_BASE_URL || 'http://127.0.0.1:3000';
const TEST_TS = Date.now();
const RUN_ID = `ddd-user-${TEST_TS}`;
const JWT_SECRET = process.env.USER_TEST_JWT_SECRET || 'PPCSecret';
const MONGODB_URI =
  envConfig.UserFunction?.MONGODB_URI ||
  envConfig.Parameters?.MONGODB_URI ||
  '';
const ALLOWED_ORIGINS = envConfig.Parameters?.ALLOWED_ORIGINS || '*';
const AUTH_BYPASS =
  envConfig.UserFunction?.AUTH_BYPASS ||
  envConfig.Parameters?.AUTH_BYPASS ||
  'false';
const VALID_ORIGIN = 'http://localhost:3000';

let dbReady = false;
let dbConnectAttempted = false;
let dbConnectError = null;

const state = {
  primaryUserId: new mongoose.Types.ObjectId(),
  conflictUserId: new mongoose.Types.ObjectId(),
  primaryEmail: `${RUN_ID}-primary@test.com`,
  conflictEmail: `${RUN_ID}-conflict@test.com`,
  primaryPhone: `+8526${String(TEST_TS).slice(-7)}`,
  conflictPhone: `+8527${String(TEST_TS).slice(-7)}`,
  primaryToken: null,
  conflictToken: null,
  refreshToken: `${RUN_ID}-refresh-token`,
};

function createContext() {
  return {
    awsRequestId: 'req-tier2-user-handler',
    callbackWaitsForEmptyEventLoop: true,
  };
}

function createEvent({
  method = 'GET',
  path = '/user/me',
  resource = '/user/me',
  body = null,
  authorizer,
  headers = {},
} = {}) {
  return {
    httpMethod: method,
    path,
    resource,
    headers,
    body,
    isBase64Encoded: false,
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    multiValueHeaders: {},
    stageVariables: null,
    requestContext: {
      requestId: 'req-tier2-user-handler',
      authorizer: authorizer || undefined,
    },
  };
}

function createLeanResult(value) {
  return {
    lean: jest.fn().mockResolvedValue(value),
  };
}

function resetEnv() {
  process.env.PROJECT_NAME = 'aws-ddd-api';
  process.env.STAGE_NAME = 'test';
  process.env.LAMBDA_ALIAS_NAME = 'test';
  process.env.CONFIG_NAMESPACE = 'test';
  process.env.NODE_ENV = 'test';
  process.env.ALLOWED_ORIGINS = '*';
  process.env.MONGODB_URI = 'mongodb://example.test/petpetclub_uat';
  process.env.AUTH_BYPASS = 'false';
  process.env.JWT_SECRET = 'test-secret';
  delete process.env.AWS_SAM_LOCAL;
}

function loadHandlerWithMocks({
  activeUser = null,
  conflictUser = null,
  updatedUser = null,
  connectError = null,
  findOneError = null,
  updateOneResult = { acknowledged: true, modifiedCount: 1 },
  deleteManyResult = { acknowledged: true, deletedCount: 1 },
} = {}) {
  jest.resetModules();
  jest.clearAllMocks();
  resetEnv();
  const actualMongoose = jest.requireActual('mongoose');

  const findOne = jest.fn((query = {}) => {
    if (findOneError) {
      throw findOneError;
    }

    if (query._id && query.deleted === false) {
      return createLeanResult(activeUser);
    }

    if (query.$or) {
      return createLeanResult(conflictUser);
    }

    return createLeanResult(null);
  });

  const findOneAndUpdate = jest.fn().mockResolvedValue(updatedUser);
  const updateOne = jest.fn().mockResolvedValue(updateOneResult);
  const deleteMany = jest.fn().mockResolvedValue(deleteManyResult);

  const userModel = {
    findOne,
    findOneAndUpdate,
    updateOne,
  };

  const refreshTokenModel = {
    deleteMany,
  };

  const mongooseMock = {
    Schema: actualMongoose.Schema,
    Types: actualMongoose.Types,
    connection: { readyState: connectError ? 0 : 1 },
    connect: connectError ? jest.fn().mockRejectedValue(connectError) : jest.fn().mockResolvedValue({}),
    models: {},
    model: jest.fn((name) => {
      if (name === 'User') return userModel;
      if (name === 'RefreshToken') return refreshTokenModel;
      throw new Error(`Unexpected model ${name}`);
    }),
  };

  jest.doMock('mongoose', () => ({
    __esModule: true,
    default: mongooseMock,
  }));

  jest.doMock('@aws-ddd-api/shared', () =>
    require(path.resolve(
      __dirname,
      '../dist/layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/index.js'
    )),
  { virtual: true });

  const { handler } = require(handlerModulePath);

  return {
    handler,
    userModel,
  };
}

function authHeaders(token, extra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    origin: VALID_ORIGIN,
    'x-forwarded-for': `198.51.100.${(TEST_TS % 200) + 1}`,
    ...extra,
  };
}

function signUserToken({ userId, email, role = 'user', expiresIn = '15m' }) {
  return jwt.sign(
    {
      userId: userId.toString(),
      userEmail: email,
      userRole: role,
    },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn }
  );
}

function expectedUnauthenticatedStatuses() {
  return AUTH_BYPASS === 'true' ? [401, 403, 404] : [401, 403];
}

function buildAlgNoneToken({ userId, email, role = 'user' }) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      userId: userId.toString(),
      userEmail: email,
      userRole: role,
      exp: Math.floor(Date.now() / 1000) + 900,
    })
  ).toString('base64url');

  return `${header}.${payload}.`;
}

async function req(method, path, body, headers = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });

  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  return {
    status: res.status,
    body: json,
    headers: Object.fromEntries(res.headers.entries()),
  };
}

async function connectDB() {
  if (!MONGODB_URI) {
    throw new Error('env.json missing UserFunction.MONGODB_URI');
  }

  if (dbReady) return;
  if (dbConnectAttempted) {
    if (dbConnectError) throw dbConnectError;
    return;
  }

  dbConnectAttempted = true;
  dns.setServers(['8.8.8.8', '1.1.1.1']);
  try {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(MONGODB_URI, {
        serverSelectionTimeoutMS: 5000,
        maxPoolSize: 2,
      });
    }
    dbReady = true;
  } catch (error) {
    dbConnectError = error;
    throw error;
  }
}

function usersCol() {
  return mongoose.connection.db.collection('users');
}

function refreshTokensCol() {
  return mongoose.connection.db.collection('refresh_tokens');
}

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function ensureSamLocalReachable() {
  try {
    await fetch(`${BASE_URL}/user/me`, { method: 'OPTIONS', headers: { origin: VALID_ORIGIN } });
  } catch {
    throw new Error(
      `SAM local API is not reachable at ${BASE_URL}. Start it with: sam local start-api --template .aws-sam/build/template.yaml --env-vars env.json --warm-containers EAGER`
    );
  }
}

async function seedUsers() {
  state.primaryToken = signUserToken({
    userId: state.primaryUserId,
    email: state.primaryEmail,
  });
  state.conflictToken = signUserToken({
    userId: state.conflictUserId,
    email: state.conflictEmail,
  });

  const now = new Date();

  await usersCol().deleteMany({
    _id: { $in: [state.primaryUserId, state.conflictUserId] },
  });
  await refreshTokensCol().deleteMany({
    userId: { $in: [state.primaryUserId, state.conflictUserId] },
  });

  await usersCol().insertMany([
    {
      _id: state.primaryUserId,
      image: 'https://example.com/original-primary.jpg',
      firstName: 'Primary',
      lastName: 'User',
      email: state.primaryEmail,
      role: 'user',
      verified: true,
      subscribe: false,
      promotion: false,
      district: 'Central',
      birthday: new Date('2020-01-01T00:00:00.000Z'),
      deleted: false,
      credit: 300,
      vetCredit: 300,
      eyeAnalysisCredit: 300,
      bloodAnalysisCredit: 300,
      phoneNumber: state.primaryPhone,
      gender: '',
      password: 'hashed-primary-password',
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: state.conflictUserId,
      image: 'https://example.com/original-conflict.jpg',
      firstName: 'Conflict',
      lastName: 'User',
      email: state.conflictEmail,
      role: 'user',
      verified: true,
      subscribe: false,
      promotion: false,
      district: 'Kowloon',
      birthday: null,
      deleted: false,
      credit: 300,
      vetCredit: 300,
      eyeAnalysisCredit: 300,
      bloodAnalysisCredit: 300,
      phoneNumber: state.conflictPhone,
      gender: '',
      password: 'hashed-conflict-password',
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await refreshTokensCol().insertOne({
    userId: state.primaryUserId,
    tokenHash: hashRefreshToken(state.refreshToken),
    createdAt: now,
    lastUsedAt: now,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
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

afterAll(async () => {
  if (dbReady && mongoose.connection.readyState !== 0) {
    await usersCol().deleteMany({
      _id: { $in: [state.primaryUserId, state.conflictUserId] },
    });
    await refreshTokensCol().deleteMany({
      userId: { $in: [state.primaryUserId, state.conflictUserId] },
    });
    await mongoose.disconnect();
  }
});

describe('Tier 2 - user handler integration', () => {
  test('GET /user/me executes the real handler, parses auth context, and returns a sanitized user', async () => {
    const userDoc = {
      _id: { toString: () => '507f1f77bcf86cd799439011' },
      firstName: 'Tier2',
      email: 'tier2@test.com',
      role: 'user',
      password: 'hashed-secret',
      deleted: false,
    };

    const { handler } = loadHandlerWithMocks({
      activeUser: userDoc,
    });

    const res = await handler(
      createEvent({
        method: 'GET',
        authorizer: {
          userId: '507f1f77bcf86cd799439011',
          userEmail: 'tier2@test.com',
          userRole: 'user',
        },
      }),
      createContext()
    );

    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.user.email).toBe('tier2@test.com');
    expect(body.user.password).toBeUndefined();
  });

  test('PATCH /user/me parses event.body as a string and rejects malformed JSON safely', async () => {
    const { handler } = loadHandlerWithMocks({
      activeUser: {
        _id: { toString: () => '507f1f77bcf86cd799439011' },
        email: 'tier2@test.com',
        role: 'user',
        deleted: false,
      },
    });

    const res = await handler(
      createEvent({
        method: 'PATCH',
        body: '{"firstName":',
        authorizer: {
          userId: '507f1f77bcf86cd799439011',
          userEmail: 'tier2@test.com',
          userRole: 'user',
        },
      }),
      createContext()
    );

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).success).toBe(false);
  });

  test('missing authorizer context is normalized to a 401 common.unauthorized response', async () => {
    const { handler } = loadHandlerWithMocks();
    const res = await handler(createEvent({ method: 'GET' }), createContext());
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).errorKey).toBe('common.unauthorized');
  });

  test('unknown route returns 404 through the real router', async () => {
    const { handler } = loadHandlerWithMocks();
    const res = await handler(
      createEvent({ method: 'GET', path: '/user/not-real', resource: '/user/not-real' }),
      createContext()
    );

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).errorKey).toBe('common.routeNotFound');
  });

  test('known path with wrong method returns 405 through the real router', async () => {
    const { handler } = loadHandlerWithMocks();
    const res = await handler(createEvent({ method: 'POST' }), createContext());

    expect(res.statusCode).toBe(405);
    expect(JSON.parse(res.body).errorKey).toBe('common.methodNotAllowed');
  });

  test('OPTIONS /user/me returns the shared CORS preflight response', async () => {
    const { handler } = loadHandlerWithMocks();
    const res = await handler(
      createEvent({
        method: 'OPTIONS',
        headers: { origin: 'http://localhost:3000' },
      }),
      createContext()
    );

    expect(res.statusCode).toBe(204);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
  });

  test('unexpected persistence errors are normalized to a safe 500 response', async () => {
    const { handler } = loadHandlerWithMocks({
      findOneError: new Error('database exploded'),
    });

    const res = await handler(
      createEvent({
        method: 'GET',
        authorizer: {
          userId: '507f1f77bcf86cd799439011',
          userEmail: 'tier2@test.com',
          userRole: 'user',
        },
      }),
      createContext()
    );

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).errorKey).toBe('common.internalError');
  });
});

describe('Tier 3/4 - /user/me via SAM local + UAT DB', () => {
  beforeAll(async () => {
    await ensureSamLocalReachable();
  });

  test('denied-origin preflight is not provable in this env because env.json uses ALLOWED_ORIGINS=*', () => {
    expect(ALLOWED_ORIGINS).toBe('*');
  });

  describe('happy paths', () => {
    test('GET /user/me returns the sanitized current user over HTTP', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedUsers();
      const res = await req('GET', '/user/me', undefined, authHeaders(state.primaryToken));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.email).toBe(state.primaryEmail);
      expect(res.body.user.password).toBeUndefined();
      expect(res.headers['access-control-allow-origin']).toBe('*');
    });

    test('PATCH /user/me persists the update and follow-up GET sees the new state', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedUsers();
      const patchRes = await req(
        'PATCH',
        '/user/me',
        {
          firstName: 'Renamed Primary',
          district: 'Wan Chai',
          image: 'https://example.com/updated-primary.jpg',
        },
        authHeaders(state.primaryToken, { 'x-forwarded-for': `198.51.110.${(TEST_TS % 200) + 1}` })
      );

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.user.firstName).toBe('Renamed Primary');

      const persisted = await usersCol().findOne({ _id: state.primaryUserId });
      expect(persisted.firstName).toBe('Renamed Primary');
      expect(persisted.district).toBe('Wan Chai');

      const getRes = await req('GET', '/user/me', undefined, authHeaders(state.primaryToken));
      expect(getRes.status).toBe(200);
      expect(getRes.body.user.firstName).toBe('Renamed Primary');
      expect(getRes.body.user.district).toBe('Wan Chai');
    });

    test('repeated GET requests remain stable across warm invocations', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedUsers();
      const first = await req('GET', '/user/me', undefined, authHeaders(state.primaryToken));
      const second = await req('GET', '/user/me', undefined, authHeaders(state.primaryToken));

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.body.user._id || second.body.user.id || second.body.user.email).toBeDefined();
    });
  });

  describe('input validation - 400', () => {
    test('PATCH /user/me rejects malformed JSON', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedUsers();
      const res = await req(
        'PATCH',
        '/user/me',
        '{"firstName":',
        authHeaders(state.primaryToken, { 'x-forwarded-for': `198.51.111.${(TEST_TS % 200) + 1}` })
      );

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('PATCH /user/me rejects invalid email format', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedUsers();
      const res = await req(
        'PATCH',
        '/user/me',
        { email: 'not-an-email' },
        authHeaders(state.primaryToken, { 'x-forwarded-for': `198.51.112.${(TEST_TS % 200) + 1}` })
      );

      expect(res.status).toBe(400);
      expect(res.body.errorKey).toBe('common.invalidBodyParams');
    });

    test('PATCH /user/me rejects invalid phone format', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedUsers();
      const res = await req(
        'PATCH',
        '/user/me',
        { phoneNumber: 'not-a-phone' },
        authHeaders(state.primaryToken, { 'x-forwarded-for': `198.51.113.${(TEST_TS % 200) + 1}` })
      );

      expect(res.status).toBe(400);
      expect(res.body.errorKey).toBe('common.invalidBodyParams');
    });

    test('PATCH /user/me rejects invalid birthday format', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedUsers();
      const res = await req(
        'PATCH',
        '/user/me',
        { birthday: 'not-a-date' },
        authHeaders(state.primaryToken, { 'x-forwarded-for': `198.51.113.${(TEST_TS % 200) + 11}` })
      );

      expect(res.status).toBe(400);
      expect(res.body.errorKey).toBe('common.invalidBodyParams');
    });

    test('PATCH /user/me rejects invalid image URL format', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedUsers();
      const res = await req(
        'PATCH',
        '/user/me',
        { image: 'javascript:alert(1)' },
        authHeaders(state.primaryToken, { 'x-forwarded-for': `198.51.113.${(TEST_TS % 200) + 12}` })
      );

      expect(res.status).toBe(400);
      expect(res.body.errorKey).toBe('common.invalidBodyParams');
    });

    test('PATCH /user/me rejects NoSQL operator injection and leaves DB unchanged', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedUsers();
      const before = await usersCol().findOne({ _id: state.primaryUserId });
      const res = await req(
        'PATCH',
        '/user/me',
        { email: { $gt: '' } },
        authHeaders(state.primaryToken, { 'x-forwarded-for': `198.51.114.${(TEST_TS % 200) + 1}` })
      );
      const after = await usersCol().findOne({ _id: state.primaryUserId });

      expect(res.status).toBe(400);
      expect(after.email).toBe(before.email);
    });
  });

  describe('business logic - 4xx', () => {
    test('PATCH /user/me rejects duplicate email conflicts', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedUsers();
      const res = await req(
        'PATCH',
        '/user/me',
        { email: state.conflictEmail },
        authHeaders(state.primaryToken, { 'x-forwarded-for': `198.51.115.${(TEST_TS % 200) + 1}` })
      );

      expect(res.status).toBe(409);
      expect(res.body.errorKey).toBe('user.errors.emailExists');
    });

    test('PATCH /user/me rejects duplicate phone conflicts', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedUsers();
      const res = await req(
        'PATCH',
        '/user/me',
        { phoneNumber: state.conflictPhone },
        authHeaders(state.primaryToken, { 'x-forwarded-for': `198.51.116.${(TEST_TS % 200) + 1}` })
      );

      expect(res.status).toBe(409);
      expect(res.body.errorKey).toBe('user.errors.phoneExists');
    });

    test('repeat delete returns not found on the second request', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedUsers();
      const disposableUserId = new mongoose.Types.ObjectId();
      const disposableEmail = `${RUN_ID}-repeat-delete@test.com`;
      const disposablePhone = `+8528${String(TEST_TS).slice(-7)}`;
      const disposableToken = signUserToken({
        userId: disposableUserId,
        email: disposableEmail,
      });
      const now = new Date();

      await usersCol().insertOne({
        _id: disposableUserId,
        image: '',
        firstName: 'Repeat',
        lastName: 'Delete',
        email: disposableEmail,
        role: 'user',
        verified: true,
        subscribe: false,
        promotion: false,
        district: null,
        birthday: null,
        deleted: false,
        credit: 300,
        vetCredit: 300,
        eyeAnalysisCredit: 300,
        bloodAnalysisCredit: 300,
        phoneNumber: disposablePhone,
        gender: '',
        createdAt: now,
        updatedAt: now,
      });

      const firstDelete = await req(
        'DELETE',
        '/user/me',
        undefined,
        authHeaders(disposableToken, { 'x-forwarded-for': `198.51.117.${(TEST_TS % 200) + 1}` })
      );
      const secondDelete = await req(
        'DELETE',
        '/user/me',
        undefined,
        authHeaders(disposableToken, { 'x-forwarded-for': `198.51.118.${(TEST_TS % 200) + 1}` })
      );

      expect(firstDelete.status).toBe(200);
      expect(secondDelete.status).toBe(404);

      await usersCol().deleteOne({ _id: disposableUserId });
    });
  });

  describe('authentication and authorisation', () => {
    test('GET /user/me rejects missing Authorization header', async () => {
      const res = await req('GET', '/user/me', undefined, {
        origin: VALID_ORIGIN,
        'x-forwarded-for': `198.51.119.${(TEST_TS % 200) + 1}`,
      });

      expect(expectedUnauthenticatedStatuses()).toContain(res.status);
    });

    test('GET /user/me rejects a garbage bearer token', async () => {
      const res = await req('GET', '/user/me', undefined, authHeaders('this.is.garbage'));
      expect([401, 403]).toContain(res.status);
    });

    test('GET /user/me rejects a malformed bearer header without the Bearer prefix', async () => {
      const res = await req('GET', '/user/me', undefined, {
        Authorization: state.primaryToken || 'not-a-bearer-header',
        origin: VALID_ORIGIN,
        'x-forwarded-for': `198.51.119.${(TEST_TS % 200) + 11}`,
      });

      expect(expectedUnauthenticatedStatuses()).toContain(res.status);
    });

    test('GET /user/me rejects an expired JWT', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedUsers();
      const expiredToken = signUserToken({
        userId: state.primaryUserId,
        email: state.primaryEmail,
        expiresIn: -60,
      });

      const res = await req('GET', '/user/me', undefined, authHeaders(expiredToken));
      expect([401, 403]).toContain(res.status);
    });

    test('GET /user/me rejects a tampered JWT', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedUsers();
      const tampered = `${state.primaryToken.slice(0, -1)}${state.primaryToken.slice(-1) === 'a' ? 'b' : 'a'}`;
      const res = await req('GET', '/user/me', undefined, authHeaders(tampered));
      expect([401, 403]).toContain(res.status);
    });

    test('GET /user/me rejects an alg:none JWT attack', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedUsers();
      const algNoneToken = buildAlgNoneToken({
        userId: state.primaryUserId,
        email: state.primaryEmail,
      });

      const res = await req('GET', '/user/me', undefined, authHeaders(algNoneToken));
      expect([401, 403]).toContain(res.status);
    });

    test('GET /user/me does not allow role escalation through a valid non-user role token', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedUsers();
      const ngoRoleToken = signUserToken({
        userId: state.primaryUserId,
        email: state.primaryEmail,
        role: 'ngo',
      });

      const res = await req('GET', '/user/me', undefined, authHeaders(ngoRoleToken));
      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe(state.primaryEmail);
    });
  });

  describe('cyberattacks and sequential security state changes', () => {
    test('PATCH /user/me strips mass-assignment fields and does not mutate protected state', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedUsers();
      const before = await usersCol().findOne({ _id: state.primaryUserId });
      const res = await req(
        'PATCH',
        '/user/me',
        {
          firstName: 'Mass Assignment Attempt',
          role: 'ngo',
          credit: 999999,
          password: 'plaintext-hack',
          deleted: true,
        },
        authHeaders(state.primaryToken, { 'x-forwarded-for': `198.51.120.${(TEST_TS % 200) + 1}` })
      );
      const after = await usersCol().findOne({ _id: state.primaryUserId });

      expect(res.status).toBe(200);
      expect(after.firstName).toBe('Mass Assignment Attempt');
      expect(after.role).toBe(before.role);
      expect(after.credit).toBe(before.credit);
      expect(after.password).toBe(before.password);
      expect(after.deleted).toBe(false);
    });

    test('PATCH /user/me ignores an injected _id field and keeps ownership bound to the JWT user', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedUsers();
      const res = await req(
        'PATCH',
        '/user/me',
        {
          _id: state.conflictUserId.toString(),
          email: `${RUN_ID}-id-injection@test.com`,
        },
        authHeaders(state.primaryToken, { 'x-forwarded-for': `198.51.120.${(TEST_TS % 200) + 11}` })
      );

      const primary = await usersCol().findOne({ _id: state.primaryUserId });
      const conflict = await usersCol().findOne({ _id: state.conflictUserId });

      expect(res.status).toBe(200);
      expect(primary.email).toBe(`${RUN_ID}-id-injection@test.com`);
      expect(conflict.email).toBe(state.conflictEmail);
    });

    test('repeated hostile duplicate-email updates remain stable and do not mutate persisted state', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedUsers();

      const first = await req(
        'PATCH',
        '/user/me',
        { email: state.conflictEmail },
        authHeaders(state.primaryToken, { 'x-forwarded-for': `198.51.120.${(TEST_TS % 200) + 12}` })
      );
      const second = await req(
        'PATCH',
        '/user/me',
        { email: state.conflictEmail },
        authHeaders(state.primaryToken, { 'x-forwarded-for': `198.51.120.${(TEST_TS % 200) + 13}` })
      );
      const primary = await usersCol().findOne({ _id: state.primaryUserId });

      expect(first.status).toBe(409);
      expect(second.status).toBe(409);
      expect(primary.email).toBe(state.primaryEmail);
    });

    test('DELETE /user/me persists deletion, blocks later GET/PATCH, and revokes refresh token for /auth/tokens/refresh', async () => {
      if (!(await ensureDbOrSkip())) return;
      await seedUsers();
      const deleteRes = await req(
        'DELETE',
        '/user/me',
        undefined,
        authHeaders(state.primaryToken, { 'x-forwarded-for': `198.51.121.${(TEST_TS % 200) + 1}` })
      );
      expect(deleteRes.status).toBe(200);

      const persistedUser = await usersCol().findOne({ _id: state.primaryUserId });
      expect(persistedUser.deleted).toBe(true);

      const refreshRecord = await refreshTokensCol().findOne({
        userId: state.primaryUserId,
        tokenHash: hashRefreshToken(state.refreshToken),
      });
      expect(refreshRecord).toBeNull();

      const getAfterDelete = await req('GET', '/user/me', undefined, authHeaders(state.primaryToken));
      expect(getAfterDelete.status).toBe(404);
      expect(getAfterDelete.body.errorKey).toBe('common.notFound');

      const patchAfterDelete = await req(
        'PATCH',
        '/user/me',
        { firstName: 'Should Fail' },
        authHeaders(state.primaryToken, { 'x-forwarded-for': `198.51.122.${(TEST_TS % 200) + 1}` })
      );
      expect(patchAfterDelete.status).toBe(404);
      expect(patchAfterDelete.body.errorKey).toBe('common.notFound');

      const refreshAfterDelete = await req(
        'POST',
        '/auth/tokens/refresh',
        {},
        {
          origin: VALID_ORIGIN,
          cookie: `refreshToken=${state.refreshToken}`,
          'x-forwarded-for': `198.51.123.${(TEST_TS % 200) + 1}`,
        }
      );
      expect(refreshAfterDelete.status).toBe(401);
      expect(refreshAfterDelete.body.errorKey).toBe('auth.refresh.invalidSession');
    });
  });

  describe('runtime boundary behavior', () => {
    test('OPTIONS /user/me returns a successful preflight for the dev wildcard origin policy', async () => {
      const res = await req('OPTIONS', '/user/me', undefined, {
        origin: VALID_ORIGIN,
      });

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('*');
    });

    test('POST /user/me is not routed by the live SAM API', async () => {
      const res = await req(
        'POST',
        '/user/me',
        { firstName: 'Wrong Method' },
        authHeaders(state.primaryToken, { 'x-forwarded-for': `198.51.124.${(TEST_TS % 200) + 1}` })
      );

      expect([403, 405]).toContain(res.status);
    });
  });
});
