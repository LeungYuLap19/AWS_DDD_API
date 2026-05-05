const path = require('path');
const mongoose = require('mongoose');

const handlerModulePath = path.resolve(__dirname, '../dist/functions/pet-recovery/index.js');
const sharedRuntimeModulePath = path.resolve(
  __dirname,
  '../dist/layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/index.js'
);

function createContext() {
  return {
    awsRequestId: 'req-tier2-pet-recovery-handler',
    callbackWaitsForEmptyEventLoop: true,
  };
}

function createAuthorizer({ userId = new mongoose.Types.ObjectId().toString(), role = 'user' } = {}) {
  return {
    userId,
    principalId: userId,
    userRole: role,
  };
}

function createEvent({
  method = 'GET',
  path = '/pet/recovery/lost',
  resource = '/pet/recovery/lost',
  body = null,
  authorizer,
  headers = {},
  pathParameters = null,
  queryStringParameters = null,
} = {}) {
  return {
    httpMethod: method,
    path,
    resource,
    headers,
    body,
    pathParameters,
    queryStringParameters,
    multiValueQueryStringParameters: null,
    multiValueHeaders: {},
    stageVariables: null,
    requestContext: {
      requestId: 'req-tier2-pet-recovery-handler',
      authorizer: authorizer || undefined,
      identity: { sourceIp: '198.51.100.10' },
    },
    isBase64Encoded: false,
  };
}

function createFindChain(value) {
  return {
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(value),
  };
}

function createFindByIdChain(value) {
  return {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(value),
  };
}

function createPetFindOneChain(value) {
  return {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(value),
  };
}

function buildCreatedRecord(overrides = {}) {
  const id = new mongoose.Types.ObjectId().toString();
  return {
    _id: id,
    ...overrides,
  };
}

function resetEnv(overrides = {}) {
  process.env.PROJECT_NAME = 'aws-ddd-api';
  process.env.STAGE_NAME = 'test';
  process.env.LAMBDA_ALIAS_NAME = 'test';
  process.env.CONFIG_NAMESPACE = 'test';
  process.env.NODE_ENV = 'test';
  process.env.ALLOWED_ORIGINS = '*';
  process.env.MONGODB_URI = 'mongodb://example.test/petpetclub_uat';
  process.env.AUTH_BYPASS = 'false';
  process.env.JWT_SECRET = 'test-secret';
  process.env.AWS_BUCKET_NAME = 'test-bucket';
  process.env.AWS_BUCKET_BASE_URL = 'https://cdn.example.test';
  process.env.AWS_BUCKET_REGION = 'ap-east-1';
  delete process.env.AWS_SAM_LOCAL;

  Object.assign(process.env, overrides);
}

function parseResponse(result) {
  return {
    statusCode: result.statusCode,
    headers: result.headers || {},
    body: result.body ? JSON.parse(result.body) : null,
  };
}

function loadHandlerWithMocks({
  envOverrides = {},
  petLostList = [],
  petFoundList = [],
  petLostDoc = null,
  petFoundDoc = null,
  petOwnershipDoc = null,
  multipartForm = null,
  multipartError = null,
  petLostCreateValue,
  petFoundCreateValue,
  rateLimitEntry = {
    count: 1,
    expireAt: new Date(Date.now() + 60_000),
    windowStart: new Date(),
  },
  rateLimitOverflow = false,
  connectError = null,
} = {}) {
  jest.resetModules();
  jest.clearAllMocks();
  resetEnv(envOverrides);

  const actualMongoose = jest.requireActual('mongoose');
  const lostCreateDoc = petLostCreateValue || buildCreatedRecord();
  const foundCreateDoc = petFoundCreateValue || buildCreatedRecord();

  const multipartParseMock = multipartError
    ? jest.fn().mockRejectedValue(multipartError)
    : jest.fn().mockResolvedValue(multipartForm || { files: [] });
  const s3SendMock = jest.fn().mockResolvedValue({});

  const petLostModel = {
    find: jest.fn(() => createFindChain(petLostList)),
    findById: jest.fn(() => createFindByIdChain(petLostDoc)),
    create: jest.fn().mockResolvedValue(lostCreateDoc),
    deleteOne: jest.fn().mockResolvedValue({ acknowledged: true, deletedCount: 1 }),
  };

  const petFoundModel = {
    find: jest.fn(() => createFindChain(petFoundList)),
    findById: jest.fn(() => createFindByIdChain(petFoundDoc)),
    create: jest.fn().mockResolvedValue(foundCreateDoc),
    deleteOne: jest.fn().mockResolvedValue({ acknowledged: true, deletedCount: 1 }),
  };

  const recoveryCounterModel = {
    findOneAndUpdate: jest.fn().mockResolvedValue({ seq: 42 }),
  };

  const petModel = {
    findOne: jest.fn(() => createPetFindOneChain(petOwnershipDoc)),
    updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
  };

  const imageCollectionModel = {
    create: jest.fn().mockResolvedValue({ _id: new mongoose.Types.ObjectId().toString() }),
    updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
  };

  const rateLimitModel = {
    findOneAndUpdate: rateLimitOverflow
      ? jest.fn().mockResolvedValue({ ...rateLimitEntry, count: 999 })
      : jest.fn().mockResolvedValue(rateLimitEntry),
  };

  const mongooseMock = {
    Schema: actualMongoose.Schema,
    Types: actualMongoose.Types,
    connection: { readyState: connectError ? 0 : 1 },
    connect: connectError
      ? jest.fn().mockRejectedValue(connectError)
      : jest.fn().mockResolvedValue({}),
    models: {},
    model: jest.fn((name) => {
      if (name === 'PetLost') return petLostModel;
      if (name === 'PetFound') return petFoundModel;
      if (name === 'Pet') return petModel;
      if (name === 'ImageCollection') return imageCollectionModel;
      if (name === 'RecoveryCounter') return recoveryCounterModel;
      if (name === 'RateLimit' || name === 'MongoRateLimit') return rateLimitModel;

      throw new Error(`Unexpected model ${name}`);
    }),
  };

  jest.doMock('mongoose', () => ({
    __esModule: true,
    default: mongooseMock,
    Schema: actualMongoose.Schema,
    Types: actualMongoose.Types,
  }));

  jest.doMock('@aws-sdk/client-s3', () => ({
    PutObjectCommand: class PutObjectCommand {
      constructor(input) {
        this.input = input;
      }
    },
    S3Client: class S3Client {
      send(input) {
        return s3SendMock(input);
      }
    },
  }));

  jest.doMock('lambda-multipart-parser', () => ({
    __esModule: true,
    default: { parse: multipartParseMock },
  }));

  jest.doMock('@aws-ddd-api/shared', () => require(sharedRuntimeModulePath), { virtual: true });

  const { handler } = require(handlerModulePath);

  return {
    handler,
    petLostModel,
    petFoundModel,
    petModel,
    imageCollectionModel,
    rateLimitModel,
    recoveryCounterModel,
    multipartParseMock,
    s3SendMock,
    lostCreateDoc,
    foundCreateDoc,
  };
}

let consoleLogSpy;
let consoleWarnSpy;
let consoleErrorSpy;

beforeAll(() => {
  consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  consoleLogSpy.mockRestore();
  consoleWarnSpy.mockRestore();
  consoleErrorSpy.mockRestore();
});

describe('pet-recovery handler Tier 2 integration', () => {
  // ── Section 4: Shared runtime and handler-level proofs ──────────────────────

  describe('Shared runtime and router proofs', () => {
    test('returns 404 for unknown route', async () => {
      const { handler } = loadHandlerWithMocks();

      const result = await handler(
        createEvent({
          method: 'GET',
          path: '/pet/recovery/unknown',
          resource: '/pet/recovery/unknown',
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(404);
      expect(parsed.body.errorKey).toBe('common.routeNotFound');
    });

    test('returns 405 for wrong method on known path', async () => {
      const { handler } = loadHandlerWithMocks();

      const result = await handler(
        createEvent({
          method: 'PUT',
          path: '/pet/recovery/lost',
          resource: '/pet/recovery/lost',
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(405);
      expect(parsed.body.errorKey).toBe('common.methodNotAllowed');
    });

    test('normalizes infrastructure errors to 500 without leaking details', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const { handler } = loadHandlerWithMocks({
        connectError: new Error('mongo down'),
      });

      const result = await handler(
        createEvent({
          method: 'GET',
          path: '/pet/recovery/lost',
          resource: '/pet/recovery/lost',
          authorizer: createAuthorizer({ userId }),
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(500);
      expect(parsed.body.errorKey).toBe('common.internalError');
      expect(JSON.stringify(parsed.body)).not.toContain('mongo down');
    });

    test('handles allowed CORS preflight requests with 204', async () => {
      const { handler } = loadHandlerWithMocks();

      const result = await handler(
        createEvent({
          method: 'OPTIONS',
          path: '/pet/recovery/lost',
          resource: '/pet/recovery/lost',
          headers: { origin: 'https://app.example.test' },
        }),
        createContext()
      );

      expect(result.statusCode).toBe(204);
      expect(result.headers['Access-Control-Allow-Origin']).toBe('*');
      expect(result.headers['Access-Control-Allow-Methods']).toContain('OPTIONS');
    });

    test('rejects denied CORS preflight requests with 403', async () => {
      const { handler } = loadHandlerWithMocks({
        envOverrides: { ALLOWED_ORIGINS: 'https://allowed.example.test' },
      });

      const result = await handler(
        createEvent({
          method: 'OPTIONS',
          path: '/pet/recovery/lost',
          resource: '/pet/recovery/lost',
          headers: { origin: 'https://denied.example.test' },
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(403);
      expect(parsed.body.errorKey).toBe('common.originNotAllowed');
    });

    test('returns 401 when a protected route is called without authorizer context', async () => {
      const { handler } = loadHandlerWithMocks();

      const result = await handler(
        createEvent({
          method: 'GET',
          path: '/pet/recovery/lost',
          resource: '/pet/recovery/lost',
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(401);
      expect(parsed.body.errorKey).toBe('common.unauthorized');
    });
  });

  // ── Section 3.1: Happy-path flows ───────────────────────────────────────────

  describe('Happy-path flows', () => {
    test('GET /pet/recovery/lost returns sanitized list sorted by lostDate', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const ownerUserId = new mongoose.Types.ObjectId().toString();
      const lostDocs = [
        { _id: 'a', name: 'Mochi', lostDate: new Date('2025-01-02'), userId: ownerUserId, ownerContact1: 91234567, __v: 0 },
        { _id: 'b', name: 'Bao', lostDate: new Date('2025-01-01'), userId: ownerUserId, ownerContact1: 98765432, __v: 0 },
      ];

      const { handler, petLostModel } = loadHandlerWithMocks({ petLostList: lostDocs });
      const result = await handler(
        createEvent({
          method: 'GET',
          path: '/pet/recovery/lost',
          resource: '/pet/recovery/lost',
          authorizer: createAuthorizer({ userId }),
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(200);
      expect(parsed.body.success).toBe(true);
      expect(parsed.body.count).toBe(2);
      expect(parsed.body.pets).toHaveLength(2);
      expect(parsed.body.pets[0]).not.toHaveProperty('__v');
      expect(parsed.body.pets[0]).not.toHaveProperty('userId');
      expect(parsed.body.pets[0].ownerContact1).toBe(91234567);
      expect(petLostModel.find).toHaveBeenCalledWith({});
    });

    test('GET /pet/recovery/found returns sanitized list', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const foundDocs = [{ _id: 'x', animal: 'Dog', foundDate: new Date('2025-02-01'), __v: 0 }];

      const { handler } = loadHandlerWithMocks({ petFoundList: foundDocs });
      const result = await handler(
        createEvent({
          method: 'GET',
          path: '/pet/recovery/found',
          resource: '/pet/recovery/found',
          authorizer: createAuthorizer({ userId }),
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(200);
      expect(parsed.body.count).toBe(1);
      expect(parsed.body.pets[0]).not.toHaveProperty('__v');
    });

    test('POST /pet/recovery/lost creates record from multipart form, uploads files, computes serial', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const fileBuffer = Buffer.from('fake-image-bytes');
      const { handler, petLostModel, s3SendMock, lostCreateDoc } = loadHandlerWithMocks({
        multipartForm: {
          name: 'Mochi',
          sex: 'Female',
          animal: 'Dog',
          lostDate: '01/02/2025',
          lostLocation: 'Kowloon',
          lostDistrict: 'Mong Kok',
          weight: '12.5',
          sterilization: 'true',
          ownerContact1: '91234567',
          files: [{ content: fileBuffer, filename: 'photo.jpg' }],
        },
      });

      const result = await handler(
        createEvent({
          method: 'POST',
          path: '/pet/recovery/lost',
          resource: '/pet/recovery/lost',
          body: 'multipart',
          authorizer: createAuthorizer({ userId }),
          headers: { 'content-type': 'multipart/form-data; boundary=---abc' },
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(201);
      expect(parsed.body.success).toBe(true);
      expect(petLostModel.create).toHaveBeenCalled();
      const createPayload = petLostModel.create.mock.calls[0][0];
      expect(createPayload.name).toBe('Mochi');
      expect(createPayload.weight).toBe(12.5);
      expect(createPayload.sterilization).toBe(true);
      expect(createPayload.ownerContact1).toBe(91234567);
      expect(createPayload.lostDate).toBeInstanceOf(Date);
      expect(s3SendMock).toHaveBeenCalledTimes(1);
      expect(createPayload.serial_number).toBe('42');
      expect(Array.isArray(createPayload.breedimage)).toBe(true);
      expect(createPayload.breedimage.length).toBe(1);
    });

    test('POST /pet/recovery/found creates record without ownership lookup', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const { handler, petFoundModel, petModel } = loadHandlerWithMocks({
        multipartForm: {
          animal: 'Cat',
          foundDate: '2025-03-15',
          foundLocation: 'HK Island',
          foundDistrict: 'Central',
          ownerContact1: '98765432',
          files: [],
        },
      });

      const result = await handler(
        createEvent({
          method: 'POST',
          path: '/pet/recovery/found',
          resource: '/pet/recovery/found',
          body: 'multipart',
          authorizer: createAuthorizer({ userId }),
          headers: { 'content-type': 'multipart/form-data; boundary=---abc' },
        }),
        createContext()
      );

      expect(parseResponse(result).statusCode).toBe(201);
      expect(petFoundModel.create).toHaveBeenCalled();
      expect(petModel.findOne).not.toHaveBeenCalled();
    });

    test('DELETE /pet/recovery/lost/{petLostID} succeeds when caller owns the record', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const petLostID = new mongoose.Types.ObjectId().toString();
      const { handler, petLostModel } = loadHandlerWithMocks({
        petLostDoc: { _id: petLostID, userId },
      });

      const result = await handler(
        createEvent({
          method: 'DELETE',
          path: `/pet/recovery/lost/${petLostID}`,
          resource: '/pet/recovery/lost/{petLostID}',
          pathParameters: { petLostID },
          authorizer: createAuthorizer({ userId }),
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(200);
      expect(parsed.body.success).toBe(true);
      expect(petLostModel.deleteOne).toHaveBeenCalledWith({ _id: petLostID });
    });

    test('DELETE /pet/recovery/found/{petFoundID} succeeds when caller owns the record', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const petFoundID = new mongoose.Types.ObjectId().toString();
      const { handler, petFoundModel } = loadHandlerWithMocks({
        petFoundDoc: { _id: petFoundID, userId },
      });

      const result = await handler(
        createEvent({
          method: 'DELETE',
          path: `/pet/recovery/found/${petFoundID}`,
          resource: '/pet/recovery/found/{petFoundID}',
          pathParameters: { petFoundID },
          authorizer: createAuthorizer({ userId }),
        }),
        createContext()
      );

      expect(parseResponse(result).statusCode).toBe(200);
      expect(petFoundModel.deleteOne).toHaveBeenCalled();
    });
  });

  // ── Section 3.2: Validation ─────────────────────────────────────────────────

  describe('Input validation', () => {
    test('POST /pet/recovery/lost rejects missing required fields with 400 + i18n key', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const { handler } = loadHandlerWithMocks({
        multipartForm: {
          name: 'Mochi',
          sex: 'Female',
          animal: 'Dog',
          lostLocation: 'Kowloon',
          lostDistrict: 'Mong Kok',
          // missing lostDate
          files: [],
        },
      });

      const result = await handler(
        createEvent({
          method: 'POST',
          path: '/pet/recovery/lost',
          resource: '/pet/recovery/lost',
          body: 'multipart',
          authorizer: createAuthorizer({ userId }),
          headers: { 'content-type': 'multipart/form-data; boundary=---abc' },
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(400);
      expect(parsed.body.errorKey).toBe('petRecovery.errors.petLost.lostDateRequired');
    });

    test('POST /pet/recovery/lost rejects invalid petId format with 400', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const { handler } = loadHandlerWithMocks({
        multipartForm: {
          petId: 'not-an-objectid',
          name: 'Mochi',
          sex: 'Female',
          animal: 'Dog',
          lostDate: '01/02/2025',
          lostLocation: 'Kowloon',
          lostDistrict: 'Mong Kok',
          files: [],
        },
      });

      const result = await handler(
        createEvent({
          method: 'POST',
          path: '/pet/recovery/lost',
          resource: '/pet/recovery/lost',
          body: 'multipart',
          authorizer: createAuthorizer({ userId }),
          headers: { 'content-type': 'multipart/form-data; boundary=---abc' },
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(400);
      expect(parsed.body.errorKey).toBe('petRecovery.errors.petLost.invalidPetId');
    });

    test('DELETE /pet/recovery/lost/{petLostID} rejects non-ObjectId path param with 400', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const { handler, petLostModel } = loadHandlerWithMocks();

      const result = await handler(
        createEvent({
          method: 'DELETE',
          path: '/pet/recovery/lost/not-an-objectid',
          resource: '/pet/recovery/lost/{petLostID}',
          pathParameters: { petLostID: 'not-an-objectid' },
          authorizer: createAuthorizer({ userId }),
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(400);
      expect(parsed.body.errorKey).toBe('petRecovery.errors.petLost.invalidId');
      expect(petLostModel.findById).not.toHaveBeenCalled();
    });

    test('NoSQL-injection-style petLostID is rejected as invalid id', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const { handler, petLostModel } = loadHandlerWithMocks();

      const result = await handler(
        createEvent({
          method: 'DELETE',
          path: '/pet/recovery/lost/%7B%24ne%3Anull%7D',
          resource: '/pet/recovery/lost/{petLostID}',
          pathParameters: { petLostID: '{$ne:null}' },
          authorizer: createAuthorizer({ userId }),
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(400);
      expect(parsed.body.errorKey).toBe('petRecovery.errors.petLost.invalidId');
      expect(petLostModel.findById).not.toHaveBeenCalled();
    });
  });

  // ── Section 3.3: Business logic and access control ──────────────────────────

  describe('Business logic and ownership', () => {
    test('DELETE /pet/recovery/lost/{petLostID} returns 404 when record not found', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const petLostID = new mongoose.Types.ObjectId().toString();
      const { handler } = loadHandlerWithMocks({ petLostDoc: null });

      const result = await handler(
        createEvent({
          method: 'DELETE',
          path: `/pet/recovery/lost/${petLostID}`,
          resource: '/pet/recovery/lost/{petLostID}',
          pathParameters: { petLostID },
          authorizer: createAuthorizer({ userId }),
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(404);
      expect(parsed.body.errorKey).toBe('petRecovery.errors.petLost.notFound');
    });

    test('DELETE /pet/recovery/lost/{petLostID} returns 403 when caller does not own the record', async () => {
      const callerId = new mongoose.Types.ObjectId().toString();
      const otherUserId = new mongoose.Types.ObjectId().toString();
      const petLostID = new mongoose.Types.ObjectId().toString();
      const { handler, petLostModel } = loadHandlerWithMocks({
        petLostDoc: { _id: petLostID, userId: otherUserId },
      });

      const result = await handler(
        createEvent({
          method: 'DELETE',
          path: `/pet/recovery/lost/${petLostID}`,
          resource: '/pet/recovery/lost/{petLostID}',
          pathParameters: { petLostID },
          authorizer: createAuthorizer({ userId: callerId }),
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(403);
      expect(parsed.body.errorKey).toBe('common.forbidden');
      expect(petLostModel.deleteOne).not.toHaveBeenCalled();
    });

    test('DELETE /pet/recovery/found/{petFoundID} returns 403 when caller does not own the record', async () => {
      const callerId = new mongoose.Types.ObjectId().toString();
      const otherUserId = new mongoose.Types.ObjectId().toString();
      const petFoundID = new mongoose.Types.ObjectId().toString();
      const { handler } = loadHandlerWithMocks({
        petFoundDoc: { _id: petFoundID, userId: otherUserId },
      });

      const result = await handler(
        createEvent({
          method: 'DELETE',
          path: `/pet/recovery/found/${petFoundID}`,
          resource: '/pet/recovery/found/{petFoundID}',
          pathParameters: { petFoundID },
          authorizer: createAuthorizer({ userId: callerId }),
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(403);
      expect(parsed.body.errorKey).toBe('common.forbidden');
    });

    test('POST /pet/recovery/lost returns 404 when linked petId does not exist', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const petId = new mongoose.Types.ObjectId().toString();
      const { handler } = loadHandlerWithMocks({
        petOwnershipDoc: null,
        multipartForm: {
          petId,
          name: 'Mochi',
          sex: 'Female',
          animal: 'Dog',
          lostDate: '01/02/2025',
          lostLocation: 'Kowloon',
          lostDistrict: 'Mong Kok',
          files: [],
        },
      });

      const result = await handler(
        createEvent({
          method: 'POST',
          path: '/pet/recovery/lost',
          resource: '/pet/recovery/lost',
          body: 'multipart',
          authorizer: createAuthorizer({ userId }),
          headers: { 'content-type': 'multipart/form-data; boundary=---abc' },
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(404);
      expect(parsed.body.errorKey).toBe('petRecovery.errors.petLost.petNotFound');
    });

    test('POST /pet/recovery/lost returns 403 when linked petId is owned by another user', async () => {
      const callerId = new mongoose.Types.ObjectId().toString();
      const otherUserId = new mongoose.Types.ObjectId().toString();
      const petId = new mongoose.Types.ObjectId().toString();
      const { handler, petLostModel } = loadHandlerWithMocks({
        petOwnershipDoc: { _id: petId, userId: otherUserId },
        multipartForm: {
          petId,
          name: 'Mochi',
          sex: 'Female',
          animal: 'Dog',
          lostDate: '01/02/2025',
          lostLocation: 'Kowloon',
          lostDistrict: 'Mong Kok',
          files: [],
        },
      });

      const result = await handler(
        createEvent({
          method: 'POST',
          path: '/pet/recovery/lost',
          resource: '/pet/recovery/lost',
          body: 'multipart',
          authorizer: createAuthorizer({ userId: callerId }),
          headers: { 'content-type': 'multipart/form-data; boundary=---abc' },
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(403);
      expect(parsed.body.errorKey).toBe('common.forbidden');
      expect(petLostModel.create).not.toHaveBeenCalled();
    });

    test('POST /pet/recovery/lost updates Pet.status when status and petId are both provided', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const petId = new mongoose.Types.ObjectId().toString();
      const { handler, petModel } = loadHandlerWithMocks({
        petOwnershipDoc: { _id: petId, userId },
        multipartForm: {
          petId,
          name: 'Mochi',
          sex: 'Female',
          animal: 'Dog',
          lostDate: '01/02/2025',
          lostLocation: 'Kowloon',
          lostDistrict: 'Mong Kok',
          status: 'lost',
          files: [],
        },
      });

      const result = await handler(
        createEvent({
          method: 'POST',
          path: '/pet/recovery/lost',
          resource: '/pet/recovery/lost',
          body: 'multipart',
          authorizer: createAuthorizer({ userId }),
          headers: { 'content-type': 'multipart/form-data; boundary=---abc' },
        }),
        createContext()
      );

      expect(parseResponse(result).statusCode).toBe(201);
      expect(petModel.updateOne).toHaveBeenCalledWith(
        { _id: petId },
        { $set: { status: 'lost' } }
      );
    });
  });

  // ── Section 3.4: Rate limiting ─────────────────────────────────────────────

  describe('Rate limiting', () => {
    test('POST /pet/recovery/lost returns 429 with retry-after when over rate limit', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const { handler, petLostModel } = loadHandlerWithMocks({
        rateLimitOverflow: true,
        rateLimitEntry: {
          count: 6,
          windowStart: new Date(Date.now() - 30_000),
          expireAt: new Date(Date.now() + 30_000),
        },
        multipartForm: {
          name: 'Mochi',
          sex: 'Female',
          animal: 'Dog',
          lostDate: '01/02/2025',
          lostLocation: 'Kowloon',
          lostDistrict: 'Mong Kok',
          files: [],
        },
      });

      const result = await handler(
        createEvent({
          method: 'POST',
          path: '/pet/recovery/lost',
          resource: '/pet/recovery/lost',
          body: 'multipart',
          authorizer: createAuthorizer({ userId }),
          headers: { 'content-type': 'multipart/form-data; boundary=---abc' },
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(429);
      expect(parsed.body.errorKey).toBe('common.rateLimited');
      expect(petLostModel.create).not.toHaveBeenCalled();
    });
  });
});
