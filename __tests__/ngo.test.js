const path = require('path');
const dns = require('dns');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const envConfig = require('../env.json');

const handlerModulePath = path.resolve(__dirname, '../dist/functions/ngo/index.js');
const authHandlerModulePath = path.resolve(__dirname, '../dist/functions/auth/index.js');
const BASE_URL = process.env.NGO_UAT_BASE_URL || 'http://127.0.0.1:3000';
const TEST_TS = Date.now();
const RUN_ID = `ddd-ngo-${TEST_TS}`;
const JWT_SECRET =
  process.env.NGO_TEST_JWT_SECRET ||
  envConfig.NgoFunction?.JWT_SECRET ||
  envConfig.AuthFunction?.JWT_SECRET ||
  'PPCSecret';
const API_KEY =
  process.env.NGO_TEST_API_KEY ||
  envConfig.Parameters?.ExistingApiKeyId ||
  'test-api-key';
const MONGODB_URI =
  envConfig.NgoFunction?.MONGODB_URI ||
  envConfig.AuthFunction?.MONGODB_URI ||
  envConfig.Parameters?.MONGODB_URI ||
  '';
const ALLOWED_ORIGINS = envConfig.Parameters?.ALLOWED_ORIGINS || '*';
const AUTH_BYPASS =
  envConfig.NgoFunction?.AUTH_BYPASS ||
  envConfig.Parameters?.AUTH_BYPASS ||
  'false';
const VALID_ORIGIN = 'http://localhost:3000';

let dbReady = false;
let dbConnectAttempted = false;
let dbConnectError = null;
let samReady = false;
let samReadyChecked = false;
let samReadyError = null;
let registrationSeq = 0;
let forwardedIpSeq = 0;

const cleanupState = {
  userIds: new Set(),
  ngoIds: new Set(),
  ngoAccessUserIds: new Set(),
  ngoCounterNgoIds: new Set(),
  userEmails: new Set(),
  userPhones: new Set(),
  ngoRegistrationNumbers: new Set(),
};

function createContext() {
  return {
    awsRequestId: 'req-tier2-ngo-handler',
    callbackWaitsForEmptyEventLoop: true,
  };
}

function createEvent({
  method = 'GET',
  path: eventPath = '/ngo/me',
  resource = '/ngo/me',
  body = null,
  authorizer,
  headers = {},
  queryStringParameters = null,
} = {}) {
  return {
    httpMethod: method,
    path: eventPath,
    resource,
    headers,
    body,
    isBase64Encoded: false,
    pathParameters: null,
    queryStringParameters,
    multiValueQueryStringParameters: null,
    multiValueHeaders: {},
    stageVariables: null,
    requestContext: {
      requestId: 'req-tier2-ngo-handler',
      authorizer: authorizer || undefined,
    },
  };
}

function createLeanResult(value, error = null) {
  return {
    select: jest.fn().mockReturnThis(),
    lean: error ? jest.fn().mockRejectedValue(error) : jest.fn().mockResolvedValue(value),
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
  process.env.REFRESH_TOKEN_MAX_AGE_SEC = '1209600';
  process.env.REFRESH_RATE_LIMIT_LIMIT = '20';
  process.env.REFRESH_RATE_LIMIT_WINDOW_SEC = '300';
  process.env.SMTP_HOST = 'smtp.test';
  process.env.SMTP_PORT = '465';
  process.env.SMTP_USER = 'smtp-user';
  process.env.SMTP_PASS = 'smtp-pass';
  process.env.SMTP_FROM = 'no-reply@test.com';
  process.env.TWILIO_ACCOUNT_SID = 'sid';
  process.env.TWILIO_AUTH_TOKEN = 'token';
  process.env.TWILIO_VERIFY_SERVICE_SID = 'verify-sid';
}

function loadHandlerWithMocks({
  userDoc = null,
  ngoDoc = null,
  ngoAccessDoc = null,
  ngoCounterDoc = null,
  aggregateData = [{ metadata: [{ total: 1 }], data: [] }],
  duplicateUser = null,
  duplicateNgo = null,
  updatedUser = null,
  updatedNgo = null,
  updatedCounter = null,
  updatedAccess = null,
  ngoFindError = null,
  userGetError = null,
  ngoCounterGetError = null,
} = {}) {
  jest.resetModules();
  jest.clearAllMocks();
  resetEnv();

  const actualMongoose = jest.requireActual('mongoose');
  const aggregateExec = jest.fn().mockResolvedValue(aggregateData);
  const aggregateAllowDiskUse = jest.fn().mockReturnValue({ exec: aggregateExec });
  const aggregate = jest.fn().mockImplementation(() => ({
    allowDiskUse: aggregateAllowDiskUse,
  }));

  const userFindOne = jest.fn((query = {}) => {
    if (query.$or) {
      return createLeanResult(duplicateUser);
    }

    if (query.email || query.phoneNumber) {
      return createLeanResult(duplicateUser);
    }

    if (query._id && query.deleted === false && userGetError) {
      return createLeanResult(null, userGetError);
    }

    return createLeanResult(userDoc);
  });

  const ngoFindOne = jest.fn((query = {}) => {
    if (ngoFindError) {
      return createLeanResult(null, ngoFindError);
    }

    if (query.registrationNumber) {
      return createLeanResult(duplicateNgo);
    }

    return createLeanResult(ngoDoc);
  });

  const ngoUserAccessFindOne = jest.fn(() => createLeanResult(ngoAccessDoc));
  const ngoCountersFindOne = jest.fn(() =>
    ngoCounterGetError ? createLeanResult(null, ngoCounterGetError) : createLeanResult(ngoCounterDoc)
  );

  const userFindOneAndUpdate = jest.fn().mockResolvedValue(updatedUser);
  const ngoFindOneAndUpdate = jest.fn().mockResolvedValue(updatedNgo);
  const ngoCountersFindOneAndUpdate = jest.fn().mockResolvedValue(updatedCounter);
  const ngoUserAccessFindOneAndUpdate = jest.fn().mockResolvedValue(updatedAccess);

  const session = {
    startTransaction: jest.fn(),
    inTransaction: jest.fn().mockReturnValue(true),
    abortTransaction: jest.fn().mockResolvedValue(undefined),
    commitTransaction: jest.fn().mockResolvedValue(undefined),
    endSession: jest.fn(),
  };

  const userModel = {
    findOne: userFindOne,
    findOneAndUpdate: userFindOneAndUpdate,
  };
  const ngoModel = {
    findOne: ngoFindOne,
    findOneAndUpdate: ngoFindOneAndUpdate,
  };
  const ngoUserAccessModel = {
    findOne: ngoUserAccessFindOne,
    findOneAndUpdate: ngoUserAccessFindOneAndUpdate,
    aggregate,
  };
  const ngoCountersModel = {
    findOne: ngoCountersFindOne,
    findOneAndUpdate: ngoCountersFindOneAndUpdate,
  };

  const mongooseMock = {
    Schema: actualMongoose.Schema,
    Types: actualMongoose.Types,
    connection: { readyState: 1 },
    connect: jest.fn().mockResolvedValue({}),
    startSession: jest.fn().mockResolvedValue(session),
    models: {},
    model: jest.fn((name) => {
      if (name === 'User') return userModel;
      if (name === 'NGO') return ngoModel;
      if (name === 'NgoUserAccess') return ngoUserAccessModel;
      if (name === 'NgoCounters') return ngoCountersModel;
      throw new Error(`Unexpected model ${name}`);
    }),
  };

  jest.doMock('mongoose', () => ({
    __esModule: true,
    default: mongooseMock,
  }));

  jest.doMock(
    '@aws-ddd-api/shared',
    () =>
      require(path.resolve(
        __dirname,
        '../dist/layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/index.js'
      )),
    { virtual: true }
  );

  const { handler } = require(handlerModulePath);

  return {
    handler,
    models: {
      userModel,
      ngoModel,
      ngoUserAccessModel,
      ngoCountersModel,
    },
    session,
    aggregate,
  };
}

function loadAuthHandlerWithMocks({
  userDoc = null,
  ngoDoc = null,
  ngoAccessDoc = null,
  refreshTokenSave = jest.fn().mockResolvedValue(undefined),
} = {}) {
  jest.resetModules();
  jest.clearAllMocks();
  resetEnv();

  const actualMongoose = jest.requireActual('mongoose');
  const userFindOne = jest.fn(() => createLeanResult(userDoc));
  const ngoFindOne = jest.fn(() => createLeanResult(ngoDoc));
  const ngoUserAccessFindOne = jest.fn(() => createLeanResult(ngoAccessDoc));

  function RefreshTokenModel(doc) {
    Object.assign(this, doc);
  }
  RefreshTokenModel.prototype.save = refreshTokenSave;

  const mongooseMock = {
    Schema: actualMongoose.Schema,
    Types: actualMongoose.Types,
    connection: { readyState: 1 },
    connect: jest.fn().mockResolvedValue({}),
    models: {},
    model: jest.fn((name) => {
      if (name === 'User') return { findOne: userFindOne };
      if (name === 'NgoUserAccess') return { findOne: ngoUserAccessFindOne };
      if (name === 'NGO') return { findOne: ngoFindOne };
      if (name === 'RefreshToken') return RefreshTokenModel;
      if (name === 'EmailVerificationCode') return { findOneAndUpdate: jest.fn(), findOne: jest.fn(), deleteOne: jest.fn() };
      if (name === 'SmsVerificationCode') return { findOne: jest.fn(), deleteOne: jest.fn() };
      if (name === 'NgoCounters') return {};
      return {};
    }),
  };

  jest.doMock('mongoose', () => ({
    __esModule: true,
    default: mongooseMock,
  }));

  jest.doMock(
    '@aws-ddd-api/shared',
    () =>
      require(path.resolve(
        __dirname,
        '../dist/layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/index.js'
      )),
    { virtual: true }
  );

  jest.doMock('bcrypt', () => ({
    __esModule: true,
    default: {
      compare: jest.fn(async (plain, hashed) => plain === 'Password123!' && hashed === 'hashed-password'),
      hash: jest.fn(async () => 'hashed-password'),
    },
  }));

  jest.doMock('../dist/functions/auth/src/config/twilio.js', () => ({
    __esModule: true,
    createSmsVerification: jest.fn(),
    checkSmsVerification: jest.fn(),
    twilioClient: {
      verify: {
        v2: {
          services: jest.fn(() => ({
            verifications: { create: jest.fn() },
            verificationChecks: { create: jest.fn() },
          })),
        },
      },
    },
  }));

  jest.doMock('../dist/functions/auth/src/config/mail.js', () => ({
    __esModule: true,
    sendMail: jest.fn(),
    smtpTransporter: {
      sendMail: jest.fn(),
    },
  }));

  jest.doMock('../dist/functions/auth/src/utils/rateLimit.js', () => ({
    __esModule: true,
    applyRateLimit: jest.fn(async () => null),
  }));

  const { handler } = require(authHandlerModulePath);

  return {
    handler,
    models: {
      userFindOne,
      ngoFindOne,
      ngoUserAccessFindOne,
    },
    refreshTokenSave,
  };
}

function nextForwardedIp() {
  forwardedIpSeq += 1;
  return `198.51.130.${((TEST_TS + forwardedIpSeq) % 200) + 1}`;
}

function authHeaders(token, extra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    'x-api-key': API_KEY,
    origin: VALID_ORIGIN,
    'x-forwarded-for': nextForwardedIp(),
    ...extra,
  };
}

function signNgoToken({
  userId,
  email,
  ngoId,
  ngoName = 'Tier 4 NGO',
  role = 'ngo',
  expiresIn = '15m',
}) {
  return jwt.sign(
    {
      userId: userId.toString(),
      userEmail: email,
      userRole: role,
      ngoId: ngoId.toString(),
      ngoName,
    },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn }
  );
}

function buildAlgNoneToken({
  userId,
  email,
  ngoId,
  ngoName = 'Tier 4 NGO',
  role = 'ngo',
}) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      userId: userId.toString(),
      userEmail: email,
      userRole: role,
      ngoId: ngoId.toString(),
      ngoName,
      exp: Math.floor(Date.now() / 1000) + 900,
    })
  ).toString('base64url');

  return `${header}.${payload}.`;
}

function expectedUnauthenticatedStatuses() {
  return AUTH_BYPASS === 'true' ? [401, 403, 404] : [401, 403];
}

async function req(method, requestPath, body, headers = {}) {
  const res = await fetch(`${BASE_URL}${requestPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(method === 'OPTIONS' ? {} : { 'x-api-key': API_KEY }),
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
    throw new Error('env.json missing NgoFunction.MONGODB_URI');
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

function ngosCol() {
  return mongoose.connection.db.collection('ngos');
}

function ngoUserAccessCol() {
  return mongoose.connection.db.collection('ngo_user_access');
}

function ngoCountersCol() {
  return mongoose.connection.db.collection('ngo_counters');
}

function refreshTokensCol() {
  return mongoose.connection.db.collection('refresh_tokens');
}

async function ensureSamLocalReachable() {
  try {
    await fetch(`${BASE_URL}/ngo/me`, { method: 'OPTIONS', headers: { origin: VALID_ORIGIN } });
  } catch {
    throw new Error(
      `SAM local API is not reachable at ${BASE_URL}. Start it with: sam local start-api --template .aws-sam/build/template.yaml --env-vars env.json --warm-containers EAGER`
    );
  }
}

async function ensureSamOrSkip() {
  if (samReady) return true;
  if (samReadyChecked) {
    if (samReadyError) {
      console.warn(`[skip] SAM local unavailable: ${samReadyError.message}`);
    }
    return false;
  }

  samReadyChecked = true;

  try {
    await ensureSamLocalReachable();
    samReady = true;
    return true;
  } catch (error) {
    samReadyError = error;
    console.warn(`[skip] SAM local unavailable: ${error.message}`);
    return false;
  }
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

function buildRegistrationPayload(label, overrides = {}) {
  registrationSeq += 1;
  const suffix = `${RUN_ID}-${label}-${registrationSeq}`;

  return {
    firstName: 'Ngo',
    lastName: `Tester ${registrationSeq}`,
    email: `${suffix}@test.com`,
    phoneNumber: `+8526${String(TEST_TS + registrationSeq).slice(-7)}`,
    password: 'Password123!',
    confirmPassword: 'Password123!',
    ngoName: `NGO ${suffix}`,
    ngoPrefix: `N${String(registrationSeq).padStart(3, '0')}`.slice(-5),
    businessRegistrationNumber: `BR-${suffix}`,
    address: {
      street: `${registrationSeq} Test Street`,
      city: 'Hong Kong',
      state: 'HK',
      zipCode: `Z${registrationSeq}`,
      country: 'String Country',
    },
    description: `Registration fixture ${suffix}`,
    website: `https://${suffix}.example.com`,
    subscribe: false,
    ...overrides,
  };
}

function trackFixture({ userId, ngoId, payload }) {
  if (userId) {
    cleanupState.userIds.add(userId.toString());
    cleanupState.ngoAccessUserIds.add(userId.toString());
  }
  if (ngoId) {
    cleanupState.ngoIds.add(ngoId.toString());
    cleanupState.ngoCounterNgoIds.add(ngoId.toString());
  }
  if (payload?.email) cleanupState.userEmails.add(payload.email);
  if (payload?.phoneNumber) cleanupState.userPhones.add(payload.phoneNumber);
  if (payload?.businessRegistrationNumber) {
    cleanupState.ngoRegistrationNumbers.add(payload.businessRegistrationNumber);
  }
}

async function registerNgoFixture({ label = 'ngo', overrides = {} } = {}) {
  const payload = buildRegistrationPayload(label, overrides);
  const res = await req('POST', '/auth/registrations/ngo', payload, {
    origin: VALID_ORIGIN,
    'x-forwarded-for': nextForwardedIp(),
  });

  if (res.status === 201) {
    trackFixture({
      userId: res.body?.userId,
      ngoId: res.body?.ngoId,
      payload,
    });
  }

  return {
    res,
    payload,
    token: res.body?.token || null,
    userId: res.body?.userId || null,
    ngoId: res.body?.ngoId || null,
    ngoUserAccessId: res.body?.ngoUserAccessId || null,
    ngoCounterId: res.body?.ngoCounterId || null,
  };
}

async function cleanupFixtures() {
  if (!dbReady || mongoose.connection.readyState === 0) {
    return;
  }

  const userObjectIds = Array.from(cleanupState.userIds)
    .filter(Boolean)
    .map((id) => new mongoose.Types.ObjectId(id));
  const ngoObjectIds = Array.from(cleanupState.ngoIds)
    .filter(Boolean)
    .map((id) => new mongoose.Types.ObjectId(id));

  if (userObjectIds.length > 0) {
    await refreshTokensCol().deleteMany({ userId: { $in: userObjectIds } });
    await ngoUserAccessCol().deleteMany({ userId: { $in: userObjectIds } });
    await usersCol().deleteMany({ _id: { $in: userObjectIds } });
  }

  if (ngoObjectIds.length > 0) {
    await ngoCountersCol().deleteMany({ ngoId: { $in: ngoObjectIds } });
    await ngoUserAccessCol().deleteMany({ ngoId: { $in: ngoObjectIds } });
    await ngosCol().deleteMany({ _id: { $in: ngoObjectIds } });
  }

  if (cleanupState.userEmails.size > 0 || cleanupState.userPhones.size > 0) {
    await usersCol().deleteMany({
      $or: [
        ...(cleanupState.userEmails.size > 0
          ? [{ email: { $in: Array.from(cleanupState.userEmails) } }]
          : []),
        ...(cleanupState.userPhones.size > 0
          ? [{ phoneNumber: { $in: Array.from(cleanupState.userPhones) } }]
          : []),
      ],
    });
  }

  if (cleanupState.ngoRegistrationNumbers.size > 0) {
    await ngosCol().deleteMany({
      registrationNumber: { $in: Array.from(cleanupState.ngoRegistrationNumbers) },
    });
  }
}

afterAll(async () => {
  await cleanupFixtures();

  if (dbReady && mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
});

describe('Tier 2 - ngo handler integration', () => {
  test('POST /auth/login/ngo returns an NGO token and refresh cookie for valid NGO credentials', async () => {
    const { handler } = loadAuthHandlerWithMocks({
      userDoc: {
        _id: { toString: () => '507f1f77bcf86cd799439011' },
        email: 'ngo@test.com',
        password: 'hashed-password',
        role: 'ngo',
        verified: true,
      },
      ngoAccessDoc: {
        ngoId: '507f1f77bcf86cd799439012',
      },
      ngoDoc: {
        _id: '507f1f77bcf86cd799439012',
        name: 'Helping Paws',
        isActive: true,
        isVerified: true,
      },
    });

    const res = await handler(
      createEvent({
        method: 'POST',
        path: '/auth/login/ngo',
        resource: '/auth/login/ngo',
        body: JSON.stringify({
          email: 'ngo@test.com',
          password: 'Password123!',
        }),
      }),
      createContext()
    );

    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.role).toBe('ngo');
    expect(body.ngoId).toBe('507f1f77bcf86cd799439012');
    expect(body.token).toBeTruthy();
    expect(res.headers['Set-Cookie']).toContain('refreshToken=');
  });

  test('POST /auth/login/ngo rejects invalid credentials', async () => {
    const { handler } = loadAuthHandlerWithMocks({
      userDoc: null,
    });

    const res = await handler(
      createEvent({
        method: 'POST',
        path: '/auth/login/ngo',
        resource: '/auth/login/ngo',
        body: JSON.stringify({
          email: 'ngo@test.com',
          password: 'WrongPassword!',
        }),
      }),
      createContext()
    );

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).errorKey).toBe('auth.login.ngo.invalidUserCredential');
  });

  test('POST /auth/login/ngo rejects unapproved NGOs', async () => {
    const { handler } = loadAuthHandlerWithMocks({
      userDoc: {
        _id: { toString: () => '507f1f77bcf86cd799439011' },
        email: 'ngo@test.com',
        password: 'hashed-password',
        role: 'ngo',
        verified: true,
      },
      ngoAccessDoc: {
        ngoId: '507f1f77bcf86cd799439012',
      },
      ngoDoc: {
        _id: '507f1f77bcf86cd799439012',
        name: 'Helping Paws',
        isActive: false,
        isVerified: true,
      },
    });

    const res = await handler(
      createEvent({
        method: 'POST',
        path: '/auth/login/ngo',
        resource: '/auth/login/ngo',
        body: JSON.stringify({
          email: 'ngo@test.com',
          password: 'Password123!',
        }),
      }),
      createContext()
    );

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).errorKey).toBe('auth.login.ngo.ngoApprovalRequired');
  });

  test('GET /ngo/me returns the sanitized NGO self profile and merged pet placement options', async () => {
    const { handler } = loadHandlerWithMocks({
      userDoc: {
        _id: { toString: () => '507f1f77bcf86cd799439011' },
        firstName: 'Ngo',
        email: 'ngo@test.com',
        role: 'ngo',
        password: 'hashed-secret',
      },
      ngoDoc: {
        _id: '507f1f77bcf86cd799439012',
        name: 'Helping Paws',
        address: {
          street: 'Tier 2 Street',
          city: 'Hong Kong',
          state: 'HK',
          zipCode: '000',
          country: 'String Country',
        },
        petPlacementOptions: [
          {
            name: 'Test Name',
            positions: ['Placement 1'],
          },
          {
            name: 'Test Name 2',
            positions: ['Updated Up', 'Down'],
          },
        ],
        isActive: true,
        isVerified: true,
      },
      ngoAccessDoc: {
        _id: '507f1f77bcf86cd799439013',
        roleInNgo: 'admin',
        isActive: true,
      },
      ngoCounterDoc: {
        _id: '507f1f77bcf86cd799439014',
        ngoPrefix: 'HP',
        seq: 42,
      },
    });

    const res = await handler(
      createEvent({
        method: 'GET',
        authorizer: {
          userId: '507f1f77bcf86cd799439011',
          userEmail: 'ngo@test.com',
          userRole: 'ngo',
          ngoId: '507f1f77bcf86cd799439012',
        },
      }),
      createContext()
    );

    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.userProfile.email).toBe('ngo@test.com');
    expect(body.userProfile.password).toBeUndefined();
    expect(body.ngoProfile.name).toBe('Helping Paws');
    expect(body.ngoProfile.address.country).toBe('String Country');
    expect(body.ngoProfile.petPlacementOptions).toEqual([
      {
        name: 'Test Name',
        positions: ['Placement 1'],
      },
      {
        name: 'Test Name 2',
        positions: ['Updated Up', 'Down'],
      },
    ]);
    expect(body.ngoCounters.ngoPrefix).toBe('HP');
  });

  test('GET /ngo/me/members scopes aggregation to the authenticated ngoId', async () => {
    const { handler, aggregate } = loadHandlerWithMocks({
      ngoDoc: {
        _id: '507f1f77bcf86cd799439012',
        name: 'Helping Paws',
        isActive: true,
        isVerified: true,
      },
      ngoAccessDoc: {
        _id: '507f1f77bcf86cd799439013',
        ngoId: '507f1f77bcf86cd799439012',
        userId: '507f1f77bcf86cd799439011',
        roleInNgo: 'admin',
        isActive: true,
      },
      aggregateData: [
        {
          metadata: [{ total: 1 }],
          data: [
            {
              userId: '507f1f77bcf86cd799439011',
              ngoId: '507f1f77bcf86cd799439012',
              user: {
                firstName: 'Jane',
                lastName: 'Smith',
                email: 'jane@test.com',
                role: 'ngo',
              },
              ngo: { name: 'Helping Paws' },
              ngoCounter: { ngoPrefix: 'HP', seq: 42 },
            },
          ],
        },
      ],
    });

    const res = await handler(
      createEvent({
        method: 'GET',
        path: '/ngo/me/members',
        resource: '/ngo/me/members',
        queryStringParameters: { page: '1', search: 'Jane' },
        authorizer: {
          userId: '507f1f77bcf86cd799439011',
          userEmail: 'ngo@test.com',
          userRole: 'ngo',
          ngoId: '507f1f77bcf86cd799439012',
        },
      }),
      createContext()
    );

    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.userList).toHaveLength(1);
    expect(body.userList[0].ngoPrefix).toBe('HP');

    const pipeline = aggregate.mock.calls[0][0];
    expect(pipeline[0].$match.ngoId.toString()).toBe('507f1f77bcf86cd799439012');
  });

  test('PATCH /ngo/me updates the authenticated NGO records in one transaction', async () => {
    const { handler, models, session } = loadHandlerWithMocks({
      ngoDoc: {
        _id: '507f1f77bcf86cd799439012',
        name: 'Helping Paws',
        isActive: true,
        isVerified: true,
      },
      ngoAccessDoc: {
        _id: '507f1f77bcf86cd799439013',
        ngoId: '507f1f77bcf86cd799439012',
        userId: '507f1f77bcf86cd799439011',
        roleInNgo: 'admin',
        isActive: true,
      },
      updatedUser: {
        _id: '507f1f77bcf86cd799439011',
        email: 'ngo@test.com',
        role: 'ngo',
        password: 'hashed-secret',
        firstName: 'Updated',
      },
      updatedNgo: {
        _id: '507f1f77bcf86cd799439012',
        description: 'Updated by test',
        address: {
          street: 'Updated Street',
          country: 'Japan',
        },
      },
      updatedCounter: {
        ngoId: '507f1f77bcf86cd799439012',
        ngoPrefix: 'HPAW',
      },
      updatedAccess: {
        ngoId: '507f1f77bcf86cd799439012',
        userId: '507f1f77bcf86cd799439011',
        roleInNgo: 'admin',
      },
    });

    const res = await handler(
      createEvent({
        method: 'PATCH',
        body: JSON.stringify({
          userProfile: { firstName: 'Updated' },
          ngoProfile: {
            description: 'Updated by test',
            address: {
              street: 'Updated Street',
              country: 'Japan',
            },
          },
          ngoCounters: { ngoPrefix: 'HPAW' },
          ngoUserAccessProfile: { menuConfig: { canManageUsers: true } },
        }),
        authorizer: {
          userId: '507f1f77bcf86cd799439011',
          userEmail: 'ngo@test.com',
          userRole: 'ngo',
          ngoId: '507f1f77bcf86cd799439012',
        },
      }),
      createContext()
    );

    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.message).toBe('Updated successfully');
    expect(session.startTransaction).toHaveBeenCalled();
    expect(session.commitTransaction).toHaveBeenCalled();
    expect(models.userModel.findOneAndUpdate).toHaveBeenCalled();
    expect(models.ngoModel.findOneAndUpdate).toHaveBeenCalled();
    expect(models.ngoCountersModel.findOneAndUpdate).toHaveBeenCalled();
    expect(models.ngoUserAccessModel.findOneAndUpdate).toHaveBeenCalled();
  });

  test('PATCH /ngo/me rejects malformed request bodies and NoSQL-style body injection', async () => {
    const { handler } = loadHandlerWithMocks({
      ngoDoc: {
        _id: '507f1f77bcf86cd799439012',
        name: 'Helping Paws',
        isActive: true,
        isVerified: true,
      },
    });

    const malformed = await handler(
      createEvent({
        method: 'PATCH',
        body: '{"userProfile":',
        authorizer: {
          userId: '507f1f77bcf86cd799439011',
          userEmail: 'ngo@test.com',
          userRole: 'ngo',
          ngoId: '507f1f77bcf86cd799439012',
        },
      }),
      createContext()
    );

    expect(malformed.statusCode).toBe(400);
    expect(JSON.parse(malformed.body).errorKey).toBe('common.invalidBodyParams');

    const injected = await handler(
      createEvent({
        method: 'PATCH',
        body: JSON.stringify({
          ngoProfile: {
            address: {
              country: { $gt: '' },
            },
          },
        }),
        authorizer: {
          userId: '507f1f77bcf86cd799439011',
          userEmail: 'ngo@test.com',
          userRole: 'ngo',
          ngoId: '507f1f77bcf86cd799439012',
        },
      }),
      createContext()
    );

    expect(injected.statusCode).toBe(400);
    expect(JSON.parse(injected.body).errorKey).toBe('common.invalidBodyParams');
  });

  test('missing authorizer context is normalized to 401 common.unauthorized', async () => {
    const { handler } = loadHandlerWithMocks();
    const res = await handler(createEvent({ method: 'GET' }), createContext());

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).errorKey).toBe('common.unauthorized');
  });

  test('wrong role is rejected as 403 common.unauthorized', async () => {
    const { handler } = loadHandlerWithMocks();
    const res = await handler(
      createEvent({
        method: 'GET',
        authorizer: {
          userId: '507f1f77bcf86cd799439011',
          userEmail: 'user@test.com',
          userRole: 'user',
        },
      }),
      createContext()
    );

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).errorKey).toBe('common.unauthorized');
  });

  test('PATCH /ngo/me rejects duplicate email conflicts', async () => {
    const { handler } = loadHandlerWithMocks({
      ngoDoc: {
        _id: '507f1f77bcf86cd799439012',
        name: 'Helping Paws',
        isActive: true,
        isVerified: true,
      },
      ngoAccessDoc: {
        _id: '507f1f77bcf86cd799439013',
        ngoId: '507f1f77bcf86cd799439012',
        userId: '507f1f77bcf86cd799439011',
        roleInNgo: 'admin',
        isActive: true,
      },
      duplicateUser: {
        _id: '507f1f77bcf86cd799439099',
        email: 'taken@test.com',
      },
    });

    const res = await handler(
      createEvent({
        method: 'PATCH',
        body: JSON.stringify({
          userProfile: { email: 'taken@test.com' },
        }),
        authorizer: {
          userId: '507f1f77bcf86cd799439011',
          userEmail: 'ngo@test.com',
          userRole: 'ngo',
          ngoId: '507f1f77bcf86cd799439012',
        },
      }),
      createContext()
    );

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).errorKey).toBe('ngo.errors.emailExists');
  });

  test('PATCH /ngo/me blocks low-privilege NGO members from mutating NGO-wide profile, counters, or access state', async () => {
    const { handler, models, session } = loadHandlerWithMocks({
      ngoDoc: {
        _id: '507f1f77bcf86cd799439012',
        name: 'Helping Paws',
        isActive: true,
        isVerified: true,
      },
      ngoAccessDoc: {
        _id: '507f1f77bcf86cd799439013',
        ngoId: '507f1f77bcf86cd799439012',
        userId: '507f1f77bcf86cd799439011',
        roleInNgo: 'staff',
        menuConfig: {
          canManageUsers: false,
        },
        isActive: true,
      },
    });

    const res = await handler(
      createEvent({
        method: 'PATCH',
        body: JSON.stringify({
          ngoProfile: {
            description: 'Privilege escalation attempt',
          },
          ngoCounters: {
            ngoPrefix: 'PWNED',
          },
          ngoUserAccessProfile: {
            roleInNgo: 'admin',
            menuConfig: {
              canManageUsers: true,
            },
          },
        }),
        authorizer: {
          userId: '507f1f77bcf86cd799439011',
          userEmail: 'ngo@test.com',
          userRole: 'ngo',
          ngoId: '507f1f77bcf86cd799439012',
        },
      }),
      createContext()
    );

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).errorKey).toBe('common.unauthorized');
    expect(session.startTransaction).not.toHaveBeenCalled();
    expect(models.ngoModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(models.ngoCountersModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(models.ngoUserAccessModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('GET /ngo/me rejects callers without an active NgoUserAccess row', async () => {
    const { handler } = loadHandlerWithMocks({
      ngoDoc: {
        _id: '507f1f77bcf86cd799439012',
        name: 'Helping Paws',
        isActive: true,
        isVerified: true,
      },
      ngoAccessDoc: null,
    });

    const res = await handler(
      createEvent({
        method: 'GET',
        authorizer: {
          userId: '507f1f77bcf86cd799439011',
          userEmail: 'ngo@test.com',
          userRole: 'ngo',
          ngoId: '507f1f77bcf86cd799439012',
        },
      }),
      createContext()
    );

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).errorKey).toBe('common.unauthorized');
  });

  test('GET /ngo/me rejects inactive or unverified NGOs', async () => {
    const { handler } = loadHandlerWithMocks({
      ngoDoc: {
        _id: '507f1f77bcf86cd799439012',
        name: 'Helping Paws',
        isActive: false,
        isVerified: true,
      },
      ngoAccessDoc: {
        _id: '507f1f77bcf86cd799439013',
        roleInNgo: 'admin',
        isActive: true,
      },
    });

    const res = await handler(
      createEvent({
        method: 'GET',
        authorizer: {
          userId: '507f1f77bcf86cd799439011',
          userEmail: 'ngo@test.com',
          userRole: 'ngo',
          ngoId: '507f1f77bcf86cd799439012',
        },
      }),
      createContext()
    );

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).errorKey).toBe('common.unauthorized');
  });

  test('unknown route returns 404 and known path with wrong method returns 405', async () => {
    const { handler } = loadHandlerWithMocks();

    const notFound = await handler(
      createEvent({
        method: 'GET',
        path: '/ngo/not-real',
        resource: '/ngo/not-real',
      }),
      createContext()
    );
    expect(notFound.statusCode).toBe(404);
    expect(JSON.parse(notFound.body).errorKey).toBe('common.routeNotFound');

    const methodNotAllowed = await handler(
      createEvent({
        method: 'POST',
        path: '/ngo/me',
        resource: '/ngo/me',
      }),
      createContext()
    );
    expect(methodNotAllowed.statusCode).toBe(405);
    expect(JSON.parse(methodNotAllowed.body).errorKey).toBe('common.methodNotAllowed');
  });

  test('OPTIONS /ngo/me returns the shared CORS preflight response', async () => {
    const { handler } = loadHandlerWithMocks();
    const res = await handler(
      createEvent({
        method: 'OPTIONS',
        headers: { origin: VALID_ORIGIN },
      }),
      createContext()
    );

    expect(res.statusCode).toBe(204);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
    expect(res.headers['Access-Control-Allow-Headers']).toContain('x-api-key');
  });

  test('GET /ngo/me returns 200 with warnings when a non-critical section lookup fails', async () => {
    const { handler } = loadHandlerWithMocks({
      userDoc: {
        _id: new mongoose.Types.ObjectId('507f1f77bcf86cd799439011'),
        email: 'ngo@test.com',
        password: 'hashed-password',
        deleted: false,
        credit: 300,
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        updatedAt: new Date('2025-01-02T00:00:00.000Z'),
      },
      ngoDoc: {
        _id: new mongoose.Types.ObjectId('507f1f77bcf86cd799439012'),
        name: 'Helping Paws',
        isActive: true,
        isVerified: true,
        createdAt: new Date('2025-01-03T00:00:00.000Z'),
      },
      ngoAccessDoc: {
        _id: new mongoose.Types.ObjectId('507f1f77bcf86cd799439013'),
        ngoId: new mongoose.Types.ObjectId('507f1f77bcf86cd799439012'),
        userId: new mongoose.Types.ObjectId('507f1f77bcf86cd799439011'),
        roleInNgo: 'admin',
        isActive: true,
        menuConfig: { canManageUsers: true },
        createdAt: new Date('2025-01-04T00:00:00.000Z'),
      },
      ngoCounterDoc: {
        _id: new mongoose.Types.ObjectId('507f1f77bcf86cd799439014'),
        ngoId: new mongoose.Types.ObjectId('507f1f77bcf86cd799439012'),
        counterType: 'ngopet',
        ngoPrefix: 'HP',
        seq: 7,
      },
      userGetError: new Error('user profile lookup failed'),
    });

    const res = await handler(
      createEvent({
        method: 'GET',
        authorizer: {
          userId: '507f1f77bcf86cd799439011',
          userEmail: 'ngo@test.com',
          userRole: 'ngo',
          ngoId: '507f1f77bcf86cd799439012',
        },
      }),
      createContext()
    );

    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.userProfile).toBeNull();
    expect(body.ngoProfile.name).toBe('Helping Paws');
    expect(body.ngoProfile.createdAt).toBeUndefined();
    expect(body.ngoUserAccessProfile.roleInNgo).toBe('admin');
    expect(body.ngoUserAccessProfile.createdAt).toBeUndefined();
    expect(body.ngoCounters.ngoPrefix).toBe('HP');
    expect(body.warnings.userProfile).toBe('ngo.warnings.temporarilyUnavailable');
    expect(body.warnings.ngoCounters).toBeNull();
  });

  test('unexpected persistence failures are normalized to a safe 500 response', async () => {
    const { handler } = loadHandlerWithMocks({
      ngoFindError: new Error('database exploded'),
    });

    const res = await handler(
      createEvent({
        method: 'GET',
        authorizer: {
          userId: '507f1f77bcf86cd799439011',
          userEmail: 'ngo@test.com',
          userRole: 'ngo',
          ngoId: '507f1f77bcf86cd799439012',
        },
      }),
      createContext()
    );

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).errorKey).toBe('common.internalError');
  });
});

describe('Tier 3/4 - NGO routes via SAM local + UAT DB', () => {
  test('denied-origin preflight is not provable in this env because env.json uses ALLOWED_ORIGINS=*', () => {
    expect(ALLOWED_ORIGINS).toBe('*');
  });

  describe('happy paths', () => {
    test('POST /auth/login/ngo signs in an existing NGO and returns a usable NGO token', async () => {
      if (!(await ensureSamOrSkip())) return;
      if (!(await ensureDbOrSkip())) return;
      const fixture = await registerNgoFixture({ label: 'login-existing-ngo' });
      expect(fixture.res.status).toBe(201);

      const res = await req(
        'POST',
        '/auth/login/ngo',
        {
          email: fixture.payload.email,
          password: fixture.payload.password,
        },
        {
          origin: VALID_ORIGIN,
          'x-forwarded-for': nextForwardedIp(),
        }
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.role).toBe('ngo');
      expect(res.body.ngoId).toBe(fixture.ngoId);
      expect(res.body.token).toBeTruthy();
      expect(res.headers['set-cookie']).toContain('refreshToken=');

      const getRes = await req('GET', '/ngo/me', undefined, authHeaders(res.body.token));
      expect(getRes.status).toBe(200);
      expect(getRes.body.ngoProfile.name).toBe(fixture.payload.ngoName);
      expect(getRes.body.userProfile.email).toBe(fixture.payload.email);
    });

    test('POST /auth/registrations/ngo persists a structured address object and returns an NGO token', async () => {
      if (!(await ensureSamOrSkip())) return;
      if (!(await ensureDbOrSkip())) return;
      const fixture = await registerNgoFixture({ label: 'register-address' });

      expect(fixture.res.status).toBe(201);
      expect(fixture.res.body.success).toBe(true);
      expect(fixture.res.body.role).toBe('ngo');
      expect(fixture.token).toBeTruthy();

      const persistedUser = await usersCol().findOne({ _id: new mongoose.Types.ObjectId(fixture.userId) });
      const persistedNgo = await ngosCol().findOne({ _id: new mongoose.Types.ObjectId(fixture.ngoId) });
      const persistedAccess = await ngoUserAccessCol().findOne({
        userId: new mongoose.Types.ObjectId(fixture.userId),
        ngoId: new mongoose.Types.ObjectId(fixture.ngoId),
      });
      const persistedCounter = await ngoCountersCol().findOne({
        ngoId: new mongoose.Types.ObjectId(fixture.ngoId),
      });

      expect(persistedUser.email).toBe(fixture.payload.email);
      expect(persistedNgo.address).toEqual(fixture.payload.address);
      expect(persistedAccess.roleInNgo).toBe('admin');
      expect(persistedCounter.ngoPrefix).toBe(fixture.payload.ngoPrefix.toUpperCase());
    });

    test('GET /ngo/me returns the registered NGO profile, access profile, counters, and structured address', async () => {
      if (!(await ensureSamOrSkip())) return;
      if (!(await ensureDbOrSkip())) return;
      const fixture = await registerNgoFixture({ label: 'get-me' });
      expect(fixture.res.status).toBe(201);

      const res = await req('GET', '/ngo/me', undefined, authHeaders(fixture.token));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.userProfile.email).toBe(fixture.payload.email);
      expect(res.body.ngoProfile.name).toBe(fixture.payload.ngoName);
      expect(res.body.ngoProfile.address).toEqual(fixture.payload.address);
      expect(res.body.ngoUserAccessProfile.roleInNgo).toBe('admin');
      expect(res.body.ngoCounters.ngoPrefix).toBe(fixture.payload.ngoPrefix.toUpperCase());
      expect(res.body.warnings.userProfile).toBeNull();
      expect(res.body.warnings.ngoCounters).toBeNull();
    });

    test('PATCH /ngo/me persists nested address changes and follow-up GET sees the new state', async () => {
      if (!(await ensureSamOrSkip())) return;
      if (!(await ensureDbOrSkip())) return;
      const fixture = await registerNgoFixture({ label: 'patch-address' });
      expect(fixture.res.status).toBe(201);

      const patchRes = await req(
        'PATCH',
        '/ngo/me',
        {
          userProfile: {
            firstName: 'Patched Ngo',
          },
          ngoProfile: {
            description: 'Tier 4 patched description',
            address: {
              street: '99 Runtime Lane',
              city: 'Taipei',
              state: 'TW',
              zipCode: '110',
              country: 'Japan',
            },
          },
          ngoCounters: {
            ngoPrefix: 'NGOX',
          },
          ngoUserAccessProfile: {
            menuConfig: {
              canManageUsers: true,
            },
          },
        },
        authHeaders(fixture.token)
      );

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.message).toBe('Updated successfully');

      const persistedNgo = await ngosCol().findOne({ _id: new mongoose.Types.ObjectId(fixture.ngoId) });
      const persistedUser = await usersCol().findOne({ _id: new mongoose.Types.ObjectId(fixture.userId) });
      const persistedAccess = await ngoUserAccessCol().findOne({
        userId: new mongoose.Types.ObjectId(fixture.userId),
        ngoId: new mongoose.Types.ObjectId(fixture.ngoId),
      });
      const persistedCounter = await ngoCountersCol().findOne({
        ngoId: new mongoose.Types.ObjectId(fixture.ngoId),
      });

      expect(persistedNgo.address).toEqual({
        street: '99 Runtime Lane',
        city: 'Taipei',
        state: 'TW',
        zipCode: '110',
        country: 'Japan',
      });
      expect(persistedNgo.description).toBe('Tier 4 patched description');
      expect(persistedUser.firstName).toBe('Patched Ngo');
      expect(persistedAccess.menuConfig.canManageUsers).toBe(true);
      expect(persistedCounter.ngoPrefix).toBe('NGOX');

      const getRes = await req('GET', '/ngo/me', undefined, authHeaders(fixture.token));
      expect(getRes.status).toBe(200);
      expect(getRes.body.userProfile.firstName).toBe('Patched Ngo');
      expect(getRes.body.ngoProfile.address.country).toBe('Japan');
      expect(getRes.body.ngoProfile.address.city).toBe('Taipei');
      expect(getRes.body.ngoCounters.ngoPrefix).toBe('NGOX');
      expect(getRes.body.ngoUserAccessProfile.menuConfig.canManageUsers).toBe(true);
    });

    test('GET /ngo/me/members returns the current NGO members scoped to the caller NGO', async () => {
      if (!(await ensureSamOrSkip())) return;
      if (!(await ensureDbOrSkip())) return;
      const fixture = await registerNgoFixture({ label: 'members' });
      expect(fixture.res.status).toBe(201);

      const res = await req(
        'GET',
        '/ngo/me/members?page=1&search=Ngo',
        undefined,
        authHeaders(fixture.token)
      );

      expect(res.status).toBe(200);
      expect(res.body.userList.length).toBeGreaterThanOrEqual(1);
      expect(res.body.userList.some((member) => member.email === fixture.payload.email)).toBe(true);
      expect(res.body.totalDocs).toBeGreaterThanOrEqual(1);
    });

    test('repeated GET /ngo/me requests remain stable across warm invocations', async () => {
      if (!(await ensureSamOrSkip())) return;
      if (!(await ensureDbOrSkip())) return;
      const fixture = await registerNgoFixture({ label: 'repeat-get' });
      expect(fixture.res.status).toBe(201);

      const first = await req('GET', '/ngo/me', undefined, authHeaders(fixture.token));
      const second = await req('GET', '/ngo/me', undefined, authHeaders(fixture.token));

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.body.ngoProfile._id || second.body.ngoProfile.name).toBeDefined();
      expect(second.body.ngoProfile.address.country).toBe(fixture.payload.address.country);
    });
  });

  describe('input validation - 400', () => {
    test('POST /auth/registrations/ngo rejects legacy string address input', async () => {
      if (!(await ensureSamOrSkip())) return;
      if (!(await ensureDbOrSkip())) return;
      const payload = buildRegistrationPayload('invalid-address', {
        address: 'Taiwan',
      });
      const res = await req('POST', '/auth/registrations/ngo', payload, {
        origin: VALID_ORIGIN,
        'x-forwarded-for': nextForwardedIp(),
      });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('PATCH /ngo/me rejects malformed JSON', async () => {
      if (!(await ensureSamOrSkip())) return;
      if (!(await ensureDbOrSkip())) return;
      const fixture = await registerNgoFixture({ label: 'malformed-json' });
      expect(fixture.res.status).toBe(201);

      const res = await req('PATCH', '/ngo/me', '{"ngoProfile":', authHeaders(fixture.token));

      expect(res.status).toBe(400);
      expect(res.body.errorKey).toBe('common.invalidBodyParams');
    });

    test('PATCH /ngo/me rejects invalid nested address field types and leaves DB unchanged', async () => {
      if (!(await ensureSamOrSkip())) return;
      if (!(await ensureDbOrSkip())) return;
      const fixture = await registerNgoFixture({ label: 'invalid-patch-address' });
      expect(fixture.res.status).toBe(201);
      const before = await ngosCol().findOne({ _id: new mongoose.Types.ObjectId(fixture.ngoId) });

      const res = await req(
        'PATCH',
        '/ngo/me',
        {
          ngoProfile: {
            address: {
              country: { $gt: '' },
            },
          },
        },
        authHeaders(fixture.token)
      );

      const after = await ngosCol().findOne({ _id: new mongoose.Types.ObjectId(fixture.ngoId) });

      expect(res.status).toBe(400);
      expect(res.body.errorKey).toBe('common.invalidBodyParams');
      expect(after.address).toEqual(before.address);
    });
  });

  describe('business logic - 4xx', () => {
    test('POST /auth/login/ngo rejects a wrong password', async () => {
      if (!(await ensureSamOrSkip())) return;
      if (!(await ensureDbOrSkip())) return;
      const fixture = await registerNgoFixture({ label: 'login-wrong-password' });
      expect(fixture.res.status).toBe(201);

      const res = await req(
        'POST',
        '/auth/login/ngo',
        {
          email: fixture.payload.email,
          password: 'WrongPassword!',
        },
        {
          origin: VALID_ORIGIN,
          'x-forwarded-for': nextForwardedIp(),
        }
      );

      expect(res.status).toBe(401);
      expect(res.body.errorKey).toBe('auth.login.ngo.invalidUserCredential');
    });

    test('POST /auth/registrations/ngo rejects duplicate business registration numbers', async () => {
      if (!(await ensureSamOrSkip())) return;
      if (!(await ensureDbOrSkip())) return;
      const primary = await registerNgoFixture({ label: 'duplicate-br-primary' });
      expect(primary.res.status).toBe(201);

      const duplicate = await registerNgoFixture({
        label: 'duplicate-br-secondary',
        overrides: {
          businessRegistrationNumber: primary.payload.businessRegistrationNumber,
        },
      });

      expect(duplicate.res.status).toBe(409);
      expect(duplicate.res.body.errorKey).toBe('auth.registration.ngo.businessRegistrationAlreadyRegistered');
    });

    test('PATCH /ngo/me rejects duplicate user email conflicts', async () => {
      if (!(await ensureSamOrSkip())) return;
      if (!(await ensureDbOrSkip())) return;
      const primary = await registerNgoFixture({ label: 'duplicate-email-primary' });
      const conflict = await registerNgoFixture({ label: 'duplicate-email-conflict' });
      expect(primary.res.status).toBe(201);
      expect(conflict.res.status).toBe(201);

      const res = await req(
        'PATCH',
        '/ngo/me',
        {
          userProfile: {
            email: conflict.payload.email,
          },
        },
        authHeaders(primary.token)
      );

      expect(res.status).toBe(409);
      expect(res.body.errorKey).toBe('ngo.errors.emailExists');
    });
  });

  describe('authentication and authorisation', () => {
    test('POST /auth/login/ngo rejects an invalid body', async () => {
      if (!(await ensureSamOrSkip())) return;
      const res = await req(
        'POST',
        '/auth/login/ngo',
        {
          email: 'not-an-email',
          password: '',
        },
        {
          origin: VALID_ORIGIN,
          'x-forwarded-for': nextForwardedIp(),
        }
      );

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('GET /ngo/me rejects missing Authorization header', async () => {
      if (!(await ensureSamOrSkip())) return;
      const res = await req('GET', '/ngo/me', undefined, {
        origin: VALID_ORIGIN,
        'x-forwarded-for': nextForwardedIp(),
      });

      expect(expectedUnauthenticatedStatuses()).toContain(res.status);
    });

    test('GET /ngo/me rejects a garbage bearer token', async () => {
      if (!(await ensureSamOrSkip())) return;
      const res = await req('GET', '/ngo/me', undefined, authHeaders('this.is.garbage'));
      expect([401, 403]).toContain(res.status);
    });

    test('GET /ngo/me rejects a malformed bearer header without the Bearer prefix', async () => {
      if (!(await ensureSamOrSkip())) return;
      const res = await req('GET', '/ngo/me', undefined, {
        Authorization: 'not-a-bearer-header',
        origin: VALID_ORIGIN,
        'x-forwarded-for': nextForwardedIp(),
      });

      expect(expectedUnauthenticatedStatuses()).toContain(res.status);
    });

    test('GET /ngo/me rejects an expired JWT', async () => {
      if (!(await ensureSamOrSkip())) return;
      if (!(await ensureDbOrSkip())) return;
      const fixture = await registerNgoFixture({ label: 'expired-jwt' });
      expect(fixture.res.status).toBe(201);

      const expiredToken = signNgoToken({
        userId: fixture.userId,
        email: fixture.payload.email,
        ngoId: fixture.ngoId,
        ngoName: fixture.payload.ngoName,
        expiresIn: -60,
      });

      const res = await req('GET', '/ngo/me', undefined, authHeaders(expiredToken));
      expect([401, 403]).toContain(res.status);
    });

    test('GET /ngo/me rejects a tampered JWT', async () => {
      if (!(await ensureSamOrSkip())) return;
      if (!(await ensureDbOrSkip())) return;
      const fixture = await registerNgoFixture({ label: 'tampered-jwt' });
      expect(fixture.res.status).toBe(201);

      const tampered = `${fixture.token.slice(0, -1)}${fixture.token.slice(-1) === 'a' ? 'b' : 'a'}`;
      const res = await req('GET', '/ngo/me', undefined, authHeaders(tampered));
      expect([401, 403]).toContain(res.status);
    });

    test('GET /ngo/me rejects an alg:none JWT attack', async () => {
      if (!(await ensureSamOrSkip())) return;
      if (!(await ensureDbOrSkip())) return;
      const fixture = await registerNgoFixture({ label: 'alg-none' });
      expect(fixture.res.status).toBe(201);

      const algNoneToken = buildAlgNoneToken({
        userId: fixture.userId,
        email: fixture.payload.email,
        ngoId: fixture.ngoId,
        ngoName: fixture.payload.ngoName,
      });

      const res = await req('GET', '/ngo/me', undefined, authHeaders(algNoneToken));
      expect([401, 403]).toContain(res.status);
    });

    test('GET /ngo/me rejects a valid token with the wrong role', async () => {
      if (!(await ensureSamOrSkip())) return;
      if (!(await ensureDbOrSkip())) return;
      const fixture = await registerNgoFixture({ label: 'wrong-role' });
      expect(fixture.res.status).toBe(201);

      const wrongRoleToken = signNgoToken({
        userId: fixture.userId,
        email: fixture.payload.email,
        ngoId: fixture.ngoId,
        ngoName: fixture.payload.ngoName,
        role: 'user',
      });

      const res = await req('GET', '/ngo/me', undefined, authHeaders(wrongRoleToken));
      expect(res.status).toBe(403);
      expect(res.body.errorKey).toBe('common.unauthorized');
    });
  });

  describe('cyberattacks and sequential security state changes', () => {
    test('POST /auth/login/ngo blocks login after NGO access revocation', async () => {
      if (!(await ensureSamOrSkip())) return;
      if (!(await ensureDbOrSkip())) return;
      const fixture = await registerNgoFixture({ label: 'login-revoked-access' });
      expect(fixture.res.status).toBe(201);

      await ngoUserAccessCol().updateOne(
        {
          userId: new mongoose.Types.ObjectId(fixture.userId),
          ngoId: new mongoose.Types.ObjectId(fixture.ngoId),
        },
        { $set: { isActive: false } }
      );

      const res = await req(
        'POST',
        '/auth/login/ngo',
        {
          email: fixture.payload.email,
          password: fixture.payload.password,
        },
        {
          origin: VALID_ORIGIN,
          'x-forwarded-for': nextForwardedIp(),
        }
      );

      expect(res.status).toBe(403);
      expect(res.body.errorKey).toBe('auth.login.ngo.userNGONotFound');
    });

    test('PATCH /ngo/me strips mass-assignment fields and preserves protected NGO and access state', async () => {
      if (!(await ensureSamOrSkip())) return;
      if (!(await ensureDbOrSkip())) return;
      const fixture = await registerNgoFixture({ label: 'mass-assignment' });
      expect(fixture.res.status).toBe(201);

      const beforeNgo = await ngosCol().findOne({ _id: new mongoose.Types.ObjectId(fixture.ngoId) });
      const beforeAccess = await ngoUserAccessCol().findOne({
        userId: new mongoose.Types.ObjectId(fixture.userId),
        ngoId: new mongoose.Types.ObjectId(fixture.ngoId),
      });

      const res = await req(
        'PATCH',
        '/ngo/me',
        {
          userProfile: {
            firstName: 'Allowed Change',
            role: 'user',
          },
          ngoProfile: {
            description: 'Allowed NGO Change',
            isVerified: false,
            isActive: false,
          },
          ngoUserAccessProfile: {
            roleInNgo: 'admin',
            isActive: false,
          },
          ngoCounters: {
            ngoPrefix: 'SAFE',
            isAdminCounter: true,
          },
        },
        authHeaders(fixture.token)
      );

      const afterNgo = await ngosCol().findOne({ _id: new mongoose.Types.ObjectId(fixture.ngoId) });
      const afterAccess = await ngoUserAccessCol().findOne({
        userId: new mongoose.Types.ObjectId(fixture.userId),
        ngoId: new mongoose.Types.ObjectId(fixture.ngoId),
      });
      const afterUser = await usersCol().findOne({ _id: new mongoose.Types.ObjectId(fixture.userId) });

      expect(res.status).toBe(200);
      expect(afterUser.firstName).toBe('Allowed Change');
      expect(afterUser.role).toBe('ngo');
      expect(afterNgo.description).toBe('Allowed NGO Change');
      expect(afterNgo.isVerified).toBe(beforeNgo.isVerified);
      expect(afterNgo.isActive).toBe(beforeNgo.isActive);
      expect(afterAccess.isActive).toBe(beforeAccess.isActive);
    });

    test('PATCH /ngo/me ignores injected _id fields and keeps ownership bound to the JWT NGO and user', async () => {
      if (!(await ensureSamOrSkip())) return;
      if (!(await ensureDbOrSkip())) return;
      const primary = await registerNgoFixture({ label: 'id-injection-primary' });
      const secondary = await registerNgoFixture({ label: 'id-injection-secondary' });
      expect(primary.res.status).toBe(201);
      expect(secondary.res.status).toBe(201);

      const injectedEmail = `${RUN_ID}-id-injection@test.com`;
      cleanupState.userEmails.add(injectedEmail);

      const res = await req(
        'PATCH',
        '/ngo/me',
        {
          userProfile: {
            _id: secondary.userId,
            email: injectedEmail,
          },
          ngoProfile: {
            _id: secondary.ngoId,
            address: {
              country: 'Japan',
            },
          },
        },
        authHeaders(primary.token)
      );

      const primaryUser = await usersCol().findOne({ _id: new mongoose.Types.ObjectId(primary.userId) });
      const primaryNgo = await ngosCol().findOne({ _id: new mongoose.Types.ObjectId(primary.ngoId) });
      const secondaryUser = await usersCol().findOne({ _id: new mongoose.Types.ObjectId(secondary.userId) });
      const secondaryNgo = await ngosCol().findOne({ _id: new mongoose.Types.ObjectId(secondary.ngoId) });

      expect(res.status).toBe(200);
      expect(primaryUser.email).toBe(injectedEmail);
      expect(primaryNgo.address.country).toBe('Japan');
      expect(secondaryUser.email).toBe(secondary.payload.email);
      expect(secondaryNgo.address.country).toBe(secondary.payload.address.country);
    });

    test('repeated hostile duplicate-email updates remain stable and do not mutate persisted state', async () => {
      if (!(await ensureSamOrSkip())) return;
      if (!(await ensureDbOrSkip())) return;
      const primary = await registerNgoFixture({ label: 'repeat-hostile-primary' });
      const conflict = await registerNgoFixture({ label: 'repeat-hostile-conflict' });
      expect(primary.res.status).toBe(201);
      expect(conflict.res.status).toBe(201);

      const first = await req(
        'PATCH',
        '/ngo/me',
        { userProfile: { email: conflict.payload.email } },
        authHeaders(primary.token)
      );
      const second = await req(
        'PATCH',
        '/ngo/me',
        { userProfile: { email: conflict.payload.email } },
        authHeaders(primary.token)
      );
      const persistedUser = await usersCol().findOne({ _id: new mongoose.Types.ObjectId(primary.userId) });

      expect(first.status).toBe(409);
      expect(second.status).toBe(409);
      expect(persistedUser.email).toBe(primary.payload.email);
    });

    test('PATCH /ngo/me rejects self-promotion and NGO-wide mutation attempts from a non-admin NGO member', async () => {
      if (!(await ensureSamOrSkip())) return;
      if (!(await ensureDbOrSkip())) return;
      const fixture = await registerNgoFixture({ label: 'low-priv-member' });
      expect(fixture.res.status).toBe(201);

      const memberUserId = new mongoose.Types.ObjectId();
      const memberEmail = `${RUN_ID}-member@test.com`;
      const memberPhone = `+8525${String(TEST_TS).slice(-7)}`;
      const memberToken = signNgoToken({
        userId: memberUserId,
        email: memberEmail,
        ngoId: fixture.ngoId,
        ngoName: fixture.payload.ngoName,
      });
      const now = new Date();

      cleanupState.userIds.add(memberUserId.toString());
      cleanupState.ngoAccessUserIds.add(memberUserId.toString());
      cleanupState.userEmails.add(memberEmail);
      cleanupState.userPhones.add(memberPhone);

      await usersCol().insertOne({
        _id: memberUserId,
        firstName: 'Low',
        lastName: 'Privilege',
        email: memberEmail,
        phoneNumber: memberPhone,
        role: 'ngo',
        verified: true,
        subscribe: false,
        promotion: false,
        district: null,
        image: null,
        birthday: null,
        deleted: false,
        credit: 300,
        vetCredit: 300,
        eyeAnalysisCredit: 300,
        bloodAnalysisCredit: 300,
        gender: '',
        createdAt: now,
        updatedAt: now,
      });

      await ngoUserAccessCol().insertOne({
        ngoId: new mongoose.Types.ObjectId(fixture.ngoId),
        userId: memberUserId,
        roleInNgo: 'staff',
        assignedPetIds: [],
        menuConfig: {
          canManageUsers: false,
          canManageNgoSettings: false,
        },
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

      const beforeNgo = await ngosCol().findOne({ _id: new mongoose.Types.ObjectId(fixture.ngoId) });
      const beforeCounter = await ngoCountersCol().findOne({ ngoId: new mongoose.Types.ObjectId(fixture.ngoId) });
      const beforeAccess = await ngoUserAccessCol().findOne({
        ngoId: new mongoose.Types.ObjectId(fixture.ngoId),
        userId: memberUserId,
      });

      const res = await req(
        'PATCH',
        '/ngo/me',
        {
          ngoProfile: {
            description: 'Escalation attempt',
          },
          ngoCounters: {
            ngoPrefix: 'PWNED',
          },
          ngoUserAccessProfile: {
            roleInNgo: 'admin',
            menuConfig: {
              canManageUsers: true,
              canManageNgoSettings: true,
            },
          },
        },
        authHeaders(memberToken)
      );

      const afterNgo = await ngosCol().findOne({ _id: new mongoose.Types.ObjectId(fixture.ngoId) });
      const afterCounter = await ngoCountersCol().findOne({ ngoId: new mongoose.Types.ObjectId(fixture.ngoId) });
      const afterAccess = await ngoUserAccessCol().findOne({
        ngoId: new mongoose.Types.ObjectId(fixture.ngoId),
        userId: memberUserId,
      });

      expect(res.status).toBe(403);
      expect(res.body.errorKey).toBe('common.unauthorized');
      expect(afterNgo.description).toBe(beforeNgo.description);
      expect(afterCounter.ngoPrefix).toBe(beforeCounter.ngoPrefix);
      expect(afterAccess.roleInNgo).toBe(beforeAccess.roleInNgo);
      expect(afterAccess.menuConfig.canManageUsers).toBe(false);
      expect(afterAccess.menuConfig.canManageNgoSettings).toBe(false);
    });

    test('repeated NoSQL-style nested address attacks stay rejected and do not mutate persisted address state', async () => {
      if (!(await ensureSamOrSkip())) return;
      if (!(await ensureDbOrSkip())) return;
      const fixture = await registerNgoFixture({ label: 'repeat-nosql-address' });
      expect(fixture.res.status).toBe(201);
      const before = await ngosCol().findOne({ _id: new mongoose.Types.ObjectId(fixture.ngoId) });

      const first = await req(
        'PATCH',
        '/ngo/me',
        {
          ngoProfile: {
            address: {
              country: { $gt: '' },
            },
          },
        },
        authHeaders(fixture.token)
      );
      const second = await req(
        'PATCH',
        '/ngo/me',
        {
          ngoProfile: {
            address: {
              country: { $gt: '' },
            },
          },
        },
        authHeaders(fixture.token)
      );
      const after = await ngosCol().findOne({ _id: new mongoose.Types.ObjectId(fixture.ngoId) });

      expect(first.status).toBe(400);
      expect(second.status).toBe(400);
      expect(after.address).toEqual(before.address);
    });

    test('access revocation persists and blocks later GET and PATCH requests with the old token', async () => {
      if (!(await ensureSamOrSkip())) return;
      if (!(await ensureDbOrSkip())) return;
      const fixture = await registerNgoFixture({ label: 'access-revocation' });
      expect(fixture.res.status).toBe(201);

      const beforeRevocation = await req('GET', '/ngo/me', undefined, authHeaders(fixture.token));
      expect(beforeRevocation.status).toBe(200);

      await ngoUserAccessCol().updateOne(
        {
          userId: new mongoose.Types.ObjectId(fixture.userId),
          ngoId: new mongoose.Types.ObjectId(fixture.ngoId),
        },
        { $set: { isActive: false } }
      );

      const getAfterRevocation = await req('GET', '/ngo/me', undefined, authHeaders(fixture.token));
      const patchAfterRevocation = await req(
        'PATCH',
        '/ngo/me',
        { ngoProfile: { description: 'Should Fail' } },
        authHeaders(fixture.token)
      );

      expect(getAfterRevocation.status).toBe(403);
      expect(getAfterRevocation.body.errorKey).toBe('common.unauthorized');
      expect(patchAfterRevocation.status).toBe(403);
      expect(patchAfterRevocation.body.errorKey).toBe('common.unauthorized');
    });
  });

  describe('runtime boundary behavior', () => {
    test('POST /auth/login/ngo is routed by the live SAM API', async () => {
      if (!(await ensureSamOrSkip())) return;
      if (!(await ensureDbOrSkip())) return;
      const fixture = await registerNgoFixture({ label: 'login-route-smoke' });
      expect(fixture.res.status).toBe(201);

      const res = await req(
        'POST',
        '/auth/login/ngo',
        {
          email: fixture.payload.email,
          password: fixture.payload.password,
        },
        {
          origin: VALID_ORIGIN,
          'x-forwarded-for': nextForwardedIp(),
        }
      );

      expect(res.status).toBe(200);
    });

    test('OPTIONS /ngo/me returns a successful preflight for the dev wildcard origin policy', async () => {
      if (!(await ensureSamOrSkip())) return;
      const res = await req('OPTIONS', '/ngo/me', undefined, {
        origin: VALID_ORIGIN,
      });

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('*');
    });

    test('POST /ngo/me is not routed by the live SAM API', async () => {
      if (!(await ensureSamOrSkip())) return;
      if (!(await ensureDbOrSkip())) return;
      const fixture = await registerNgoFixture({ label: 'wrong-method' });
      expect(fixture.res.status).toBe(201);

      const res = await req(
        'POST',
        '/ngo/me',
        { ngoProfile: { description: 'Wrong Method' } },
        authHeaders(fixture.token)
      );

      expect([403, 405]).toContain(res.status);
    });
  });
});
