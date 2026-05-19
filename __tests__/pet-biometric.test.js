const path = require('path');
const mongoose = require('mongoose');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');

const handlerModulePath = path.resolve(__dirname, '../dist/functions/pet-biometric/index.js');
const sharedRuntimeModulePath = path.resolve(
  __dirname,
  '../dist/layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/index.js'
);
const sharedValidationZodModulePath = path.resolve(
  __dirname,
  '../dist/layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/validation/zod.js'
);
const sharedRateLimitMongoModulePath = path.resolve(
  __dirname,
  '../dist/layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/rate-limit/mongo.js'
);

const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

function createContext() {
  return {
    awsRequestId: 'req-pet-biometric-handler',
    callbackWaitsForEmptyEventLoop: true,
  };
}

function createAuthorizer({ userId = new mongoose.Types.ObjectId().toString(), role = 'user', ngoId } = {}) {
  const authorizer = {
    userId,
    principalId: userId,
    userRole: role,
  };
  if (ngoId !== undefined) authorizer.ngoId = ngoId;
  return authorizer;
}

function createEvent({
  method = 'GET',
  path: reqPath,
  resource = reqPath,
  body = null,
  authorizer,
  headers = {},
  pathParameters = null,
} = {}) {
  return {
    httpMethod: method,
    path: reqPath,
    resource,
    headers,
    body,
    pathParameters,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    multiValueHeaders: {},
    stageVariables: null,
    requestContext: {
      requestId: 'req-pet-biometric-handler',
      authorizer: authorizer || undefined,
      identity: {
        sourceIp: '203.0.113.12',
      },
    },
    isBase64Encoded: false,
  };
}

function parseResponse(result) {
  return {
    statusCode: result.statusCode,
    headers: result.headers,
    body: result.body ? JSON.parse(result.body) : null,
  };
}

function createLeanResult(value) {
  return {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(value),
    exec: jest.fn().mockResolvedValue(value),
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
  process.env.AWS_BUCKET_NAME = 'pet-biometric-bucket';
  process.env.AWS_BUCKET_REGION = 'ap-east-1';
  process.env.ML_INFERENCE_FUNCTION_NAME = 'aws-ddd-api-test-ml-inference';
  delete process.env.AWS_SAM_LOCAL;
}

function buildMlInvokePayload(result) {
  return {
    Payload: Buffer.from(JSON.stringify({
      ok: true,
      op: result.op,
      data: result.data,
    })),
  };
}

function resolveLambdaResponseBody(lambdaInvokeResult) {
  if (!lambdaInvokeResult) {
    return JSON.stringify({
      ok: true,
      op: 'register',
      data: {
        status: 'accepted',
        angle: 'front-face',
        embedding: [0.11, -0.22],
      },
    });
  }

  if (Buffer.isBuffer(lambdaInvokeResult)) {
    return lambdaInvokeResult;
  }

  if (typeof lambdaInvokeResult === 'string') {
    return lambdaInvokeResult;
  }

  if (lambdaInvokeResult.Payload) {
    return Buffer.from(lambdaInvokeResult.Payload);
  }

  return JSON.stringify(lambdaInvokeResult);
}

function loadHandlerWithMocks({
  authUserId = new mongoose.Types.ObjectId().toString(),
  authRole = 'user',
  authNgoId,
  petId = new mongoose.Types.ObjectId().toString(),
  petDoc,
  multipartPayload = { files: [] },
  rateLimitError = null,
  biometricFindQueue = [],
  lambdaInvokeResult,
} = {}) {
  jest.resetModules();
  jest.clearAllMocks();
  resetEnv();

  const actualMongoose = jest.requireActual('mongoose');
  const resolvedPetDoc = petDoc === undefined
    ? { _id: petId, userId: authUserId, deleted: false }
    : petDoc;
  const biometricQueue = [...biometricFindQueue];

  const petModel = {
    findOne: jest.fn(() => createLeanResult(resolvedPetDoc)),
  };

  const petBiometricModel = {
    findOne: jest.fn(() => createLeanResult(biometricQueue.length ? biometricQueue.shift() : null)),
    updateOne: jest.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 1, upsertedCount: 1 }),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
  };

  const mongooseMock = {
    Schema: actualMongoose.Schema,
    Types: actualMongoose.Types,
    connection: { readyState: 1 },
    connect: jest.fn().mockResolvedValue({}),
    models: {
      User: {},
      Pet: {},
      NgoCounters: {},
      PetBiometric: {},
    },
    isValidObjectId: actualMongoose.isValidObjectId,
    model: jest.fn((name) => {
      if (name === 'Pet') return petModel;
      if (name === 'PetBiometric') return petBiometricModel;
      if (name === 'User') return {};
      if (name === 'NgoCounters') return {};
      throw new Error(`Unexpected model ${name}`);
    }),
  };

  const s3SendMock = jest.fn().mockResolvedValue({});
  const lambdaHttpRequests = [];
  const requireMongoRateLimitMock = rateLimitError
    ? jest.fn().mockRejectedValue(rateLimitError)
    : jest.fn().mockResolvedValue(undefined);

  jest.doMock('mongoose', () => ({
    __esModule: true,
    default: mongooseMock,
  }));
  jest.doMock('@aws-sdk/client-s3', () => ({
    S3Client: jest.fn().mockImplementation(() => ({ send: s3SendMock })),
    PutObjectCommand: jest.fn((input) => input),
    DeleteObjectCommand: jest.fn((input) => input),
  }));
  jest.doMock('@aws-sdk/client-lambda', () => ({
    LambdaClient: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
    InvokeCommand: jest.fn((input) => input),
  }));
  const httpsRequest = jest.fn().mockImplementation((options, callback) => {
    const request = new EventEmitter();
    const chunks = [];

    request.write = jest.fn((chunk) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return true;
    });
    request.setHeader = jest.fn();
    request.getHeader = jest.fn();
    request.removeHeader = jest.fn();
    request.setTimeout = jest.fn();
    request.destroy = jest.fn();
    request.abort = jest.fn();
    request.end = jest.fn((chunk) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));

      const response = new PassThrough();
      const requestPath = String(options.path || '');
      const requestMethod = String(options.method || 'GET').toUpperCase();
      const isLambdaInvoke = requestMethod === 'POST' && requestPath.includes('/invocations');

      if (!isLambdaInvoke) {
        process.nextTick(() => request.emit('error', new Error(`Unexpected https.request ${requestMethod} ${requestPath}`)));
        return request;
      }

      lambdaHttpRequests.push({
        options,
        body: Buffer.concat(chunks).toString('utf8'),
      });

      response.statusCode = 200;
      response.statusMessage = 'OK';
      response.headers = {
        'content-type': 'application/json',
        'x-amzn-requestid': 'req-ml-invoke',
      };
      callback(response);

      process.nextTick(() => {
        response.end(resolveLambdaResponseBody(lambdaInvokeResult));
      });

      return request;
    });

    return request;
  });
  const realHttps = jest.requireActual('https');
  const realNodeHttps = jest.requireActual('node:https');
  jest.doMock('https', () => ({
    __esModule: true,
    ...realHttps,
    default: { ...realHttps, request: httpsRequest },
    request: httpsRequest,
  }));
  jest.doMock('node:https', () => ({
    __esModule: true,
    ...realNodeHttps,
    default: { ...realNodeHttps, request: httpsRequest },
    request: httpsRequest,
  }));
  jest.doMock('@aws-ddd-api/shared', () => {
    const realShared = require(sharedRuntimeModulePath);
    return {
      ...realShared,
      requireMongoRateLimit: requireMongoRateLimitMock,
    };
  }, { virtual: true });
  jest.doMock('@aws-ddd-api/shared/validation/zod', () => {
    const realSharedValidation = require(sharedValidationZodModulePath);
    return {
      ...realSharedValidation,
      parseMultipartBody: async (_event, schema, options = {}) => {
        const form = multipartPayload || {};
        const files = (Array.isArray(form.files) ? form.files : []).map((file) => ({
          fieldname: file.fieldname || 'image',
          filename: file.filename || 'upload.jpg',
          contentType: file.contentType || 'image/jpeg',
          content: file.content || jpegBuffer,
        }));

        const rawFields = { ...form };
        delete rawFields.files;

        const normalizedFields = options.normalize ? options.normalize(rawFields) : rawFields;
        const parsed = schema.safeParse(normalizedFields);
        if (!parsed.success) {
          const fallback = options.fallbackErrorKey || 'common.invalidBodyParams';
          const message = realSharedValidation.getFirstZodIssueMessage(parsed.error, fallback);
          const errorKey = message.includes('.') ? message : fallback;
          return { ok: false, statusCode: 400, errorKey };
        }

        return { ok: true, data: parsed.data, files };
      },
    };
  }, { virtual: true });
  jest.doMock('@aws-ddd-api/shared/rate-limit/mongo', () => {
    const realSharedRateLimit = require(sharedRateLimitMongoModulePath);
    return {
      ...realSharedRateLimit,
      requireMongoRateLimit: requireMongoRateLimitMock,
    };
  }, { virtual: true });

  const { handler } = require(handlerModulePath);
  const authorizer = createAuthorizer({ userId: authUserId, role: authRole, ngoId: authNgoId });

  return {
    handler,
    authorizer,
    petId,
    petModel,
    petBiometricModel,
    s3SendMock,
    lambdaHttpRequests,
    requireMongoRateLimitMock,
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

describe('pet-biometric handler local integration', () => {
  test('returns 404 for unknown route', async () => {
    const { handler, authorizer } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'GET',
        path: '/pet/biometric/not-found',
        resource: '/pet/biometric/not-found',
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(404);
    expect(parsed.body.errorKey).toBe('common.routeNotFound');
  });

  test('GET /pet/biometric/{petId} returns summary and completion state', async () => {
    const petId = new mongoose.Types.ObjectId().toString();
    const authUserId = new mongoose.Types.ObjectId().toString();
    const { handler, authorizer } = loadHandlerWithMocks({
      petId,
      authUserId,
      biometricFindQueue: [
        {
          petId,
          userId: authUserId,
          petType: 'dog',
          imageKeys: ['user-uploads/pets/a.jpg'],
          embeddings: Array.from({ length: 10 }, () => ({ angle: 'front-face', embedding: [0.1, 0.2] })),
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    const result = await handler(
      createEvent({
        method: 'GET',
        path: `/pet/biometric/${petId}`,
        resource: '/pet/biometric/{petId}',
        pathParameters: { petId },
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(200);
    expect(parsed.body.success).toBe(true);
    expect(parsed.body.data.petId).toBe(petId);
    expect(parsed.body.data.userId).toBe(authUserId);
    expect(parsed.body.data.hasFaceId).toBe(true);
    expect(parsed.body.data.biometric.petType).toBe('dog');
  });

  test('DELETE /pet/biometric/{petId} deletes the biometric document', async () => {
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler, authorizer, petBiometricModel } = loadHandlerWithMocks({ petId });

    const result = await handler(
      createEvent({
        method: 'DELETE',
        path: `/pet/biometric/${petId}`,
        resource: '/pet/biometric/{petId}',
        pathParameters: { petId },
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(200);
    expect(parsed.body.success).toBe(true);
    expect(parsed.body.data.petId).toBe(petId);
    expect(parsed.body.data.deleted).toBe(true);
    expect(petBiometricModel.deleteOne).toHaveBeenCalledWith({ petId });
  });

  test('POST /pet/biometric/{petId}/registrations persists accepted enrollment output', async () => {
    const petId = new mongoose.Types.ObjectId().toString();
    const authUserId = new mongoose.Types.ObjectId().toString();
    const { handler, authorizer, petBiometricModel, lambdaHttpRequests, s3SendMock } = loadHandlerWithMocks({
      petId,
      authUserId,
      multipartPayload: {
        petType: 'dog',
        files: [{ filename: 'register.jpg', content: jpegBuffer }],
      },
      biometricFindQueue: [
        null,
        {
          petId,
          userId: authUserId,
          petType: 'dog',
          embeddings: [{ angle: 'front-face', embedding: [0.11, -0.22] }],
        },
      ],
      lambdaInvokeResult: buildMlInvokePayload({
        op: 'register',
        data: {
          status: 'accepted',
          angle: 'front-face',
          embedding: [0.11, -0.22],
        },
      }),
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: `/pet/biometric/${petId}/registrations`,
        resource: '/pet/biometric/{petId}/registrations',
        pathParameters: { petId },
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(201);
    expect(parsed.body.success).toBe(true);
    expect(parsed.body.data.remaining).toBe(9);
    expect(parsed.body.data.canFinish).toBe(false);
    expect(petBiometricModel.updateOne).toHaveBeenCalledTimes(1);
    expect(s3SendMock).toHaveBeenCalledTimes(1);

    const invokePayload = JSON.parse(lambdaHttpRequests[0].body);
    expect(invokePayload.op).toBe('register');
    expect(invokePayload.petId).toBe(petId);
    expect(invokePayload.body.petType).toBe('dog');
    expect(invokePayload.body.image.bucket).toBe('pet-biometric-bucket');
  });

  test('POST /pet/biometric/{petId}/registrations returns 400 when no image is accepted', async () => {
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler, authorizer, petBiometricModel } = loadHandlerWithMocks({
      petId,
      multipartPayload: {
        petType: 'dog',
        files: [{ filename: 'register.jpg', content: jpegBuffer }],
      },
      biometricFindQueue: [null],
      lambdaInvokeResult: buildMlInvokePayload({
        op: 'register',
        data: {
          status: 'no_face',
        },
      }),
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: `/pet/biometric/${petId}/registrations`,
        resource: '/pet/biometric/{petId}/registrations',
        pathParameters: { petId },
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('petBiometric.errors.noAcceptedImages');
    expect(petBiometricModel.updateOne).not.toHaveBeenCalled();
  });

  test('POST /pet/biometric/{petId}/verifications returns mapped ML verification result', async () => {
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler, authorizer, lambdaHttpRequests, s3SendMock } = loadHandlerWithMocks({
      petId,
      multipartPayload: {
        petType: 'dog',
        threshold: '0.7',
        files: [{ filename: 'verify.jpg', content: jpegBuffer }],
      },
      biometricFindQueue: [
        { petId, petType: 'dog', embeddings: [{ angle: 'front-face', embedding: [0.1, 0.2] }] },
        { embeddings: [{ angle: 'front-face', embedding: [0.1, 0.2] }] },
      ],
      lambdaInvokeResult: buildMlInvokePayload({
        op: 'verify',
        data: {
          status: 'matched',
          similarity: 99.1,
          angle: 'front-face',
        },
      }),
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: `/pet/biometric/${petId}/verifications`,
        resource: '/pet/biometric/{petId}/verifications',
        pathParameters: { petId },
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(200);
    expect(parsed.body.success).toBe(true);
    expect(parsed.body.data.matched).toBe(true);
    expect(parsed.body.data.completed).toBe(true);
    expect(parsed.body.data.status).toBe('matched');
    expect(parsed.body.data.similarity).toBe(99.1);
    expect(parsed.body.data.angle).toBe('front-face');
    expect(s3SendMock).toHaveBeenCalledTimes(2);

    const invokePayload = JSON.parse(lambdaHttpRequests[0].body);
    expect(invokePayload.op).toBe('verify');
    expect(invokePayload.body.threshold).toBe(0.7);
    expect(Array.isArray(invokePayload.body.candidates)).toBe(true);
    expect(invokePayload.body.candidates).toHaveLength(1);
  });

  test('POST /pet/biometric/{petId}/verifications rejects multiple uploaded files', async () => {
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler, authorizer } = loadHandlerWithMocks({
      petId,
      multipartPayload: {
        petType: 'dog',
        files: [
          { filename: 'verify-a.jpg', content: jpegBuffer },
          { filename: 'verify-b.jpg', content: jpegBuffer },
        ],
      },
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: `/pet/biometric/${petId}/verifications`,
        resource: '/pet/biometric/{petId}/verifications',
        pathParameters: { petId },
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('petBiometric.errors.tooManyFiles');
  });
});
