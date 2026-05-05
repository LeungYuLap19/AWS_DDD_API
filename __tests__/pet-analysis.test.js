const path = require('path');
const mongoose = require('mongoose');

const handlerModulePath = path.resolve(__dirname, '../dist/functions/pet-analysis/index.js');
const sharedRuntimeModulePath = path.resolve(
  __dirname,
  '../dist/layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/index.js'
);

function createContext() {
  return {
    awsRequestId: 'req-pet-analysis-handler',
    callbackWaitsForEmptyEventLoop: true,
  };
}

function createAuthorizer({ userId = new mongoose.Types.ObjectId().toString(), role = 'user', ngoId } = {}) {
  const authorizer = { userId, principalId: userId, userRole: role };
  if (ngoId !== undefined) authorizer.ngoId = ngoId;
  return authorizer;
}

function createEvent({
  method = 'GET',
  path: reqPath,
  resource,
  body = null,
  authorizer,
  pathParameters = null,
  headers = {},
} = {}) {
  return {
    httpMethod: method,
    path: reqPath,
    resource: resource || reqPath,
    headers,
    body,
    pathParameters,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    multiValueHeaders: {},
    stageVariables: null,
    requestContext: {
      requestId: 'req-pet-analysis-handler',
      authorizer: authorizer || undefined,
      identity: { sourceIp: '203.0.113.9' },
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
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
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
  process.env.AWS_BUCKET_NAME = 'bucket';
  process.env.AWS_BUCKET_BASE_URL = 'https://bucket.example';
  process.env.AWS_BUCKET_REGION = 'ap-east-1';
  process.env.VM_PUBLIC_IP = 'http://127.0.0.1:';
  process.env.DOCKER_IMAGE = '8080/eye-predict';
  process.env.HEATMAP = '8080/eye-heatmap';
  process.env.VM_BREED_PUBLIC_IP = 'http://127.0.0.1:';
  process.env.BREED_DOCKER_IMAGE = '8001/predict';
  delete process.env.AWS_SAM_LOCAL;
}

function loadHandlerWithMocks({
  authUserId = new mongoose.Types.ObjectId().toString(),
  authRole = 'user',
  authNgoId,
  petDoc,
  userDoc,
  eyeDiseaseDoc,
  multipartPayload = { files: [] },
  petFindOneAndUpdateResult = null,
} = {}) {
  jest.resetModules();
  jest.clearAllMocks();
  resetEnv();

  const actualMongoose = jest.requireActual('mongoose');

  const petModel = {
    findOne: jest.fn((query) => {
      if (query && query._id && query.deleted && query.deleted.$ne === true) {
        return createLeanResult(petDoc === undefined ? null : petDoc);
      }
      return {
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(petDoc === undefined ? null : petDoc),
      };
    }),
    findOneAndUpdate: jest.fn().mockResolvedValue(petFindOneAndUpdateResult),
  };

  const resolvedUserDoc = userDoc !== undefined ? userDoc : { _id: authUserId, deleted: false };
  const userModel = {
    findOne: jest.fn(() => createLeanResult(resolvedUserDoc)),
  };

  const eyeAnalysisModel = {
    find: jest.fn(() => createLeanResult([])),
    create: jest.fn().mockResolvedValue({ _id: new actualMongoose.Types.ObjectId().toString() }),
  };

  const eyeDiseaseModel = {
    findOne: jest.fn(() => createLeanResult(eyeDiseaseDoc === undefined ? null : eyeDiseaseDoc)),
  };

  const imageCollectionModel = {
    create: jest.fn().mockResolvedValue({ _id: new actualMongoose.Types.ObjectId().toString() }),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  };

  const apiLogRecord = {
    _id: new actualMongoose.Types.ObjectId().toString(),
    save: jest.fn().mockResolvedValue(undefined),
  };

  const apiLogModel = {
    create: jest.fn().mockResolvedValue(apiLogRecord),
  };

  const rateLimitModel = {
    findOneAndUpdate: jest.fn().mockResolvedValue({
      count: 1,
      expireAt: new Date(Date.now() + 60_000),
      windowStart: new Date(),
    }),
  };

  const mongooseMock = {
    Schema: actualMongoose.Schema,
    Types: actualMongoose.Types,
    connection: { readyState: 1 },
    connect: jest.fn().mockResolvedValue({}),
    models: {},
    isValidObjectId: actualMongoose.isValidObjectId,
    model: jest.fn((name) => {
      if (name === 'Pet') return petModel;
      if (name === 'User') return userModel;
      if (name === 'EyeAnalysisRecord') return eyeAnalysisModel;
      if (name === 'EyeDiseaseList') return eyeDiseaseModel;
      if (name === 'ImageCollection') return imageCollectionModel;
      if (name === 'ApiLog') return apiLogModel;
      if (name === 'RateLimit' || name === 'MongoRateLimit') return rateLimitModel;
      throw new Error(`Unexpected model ${name}`);
    }),
  };

  jest.doMock('mongoose', () => ({ __esModule: true, default: mongooseMock }));
  jest.doMock('@aws-ddd-api/shared', () => require(sharedRuntimeModulePath), { virtual: true });
  jest.doMock('@aws-sdk/client-s3', () => ({
    S3Client: jest.fn().mockImplementation(() => ({ send: jest.fn().mockResolvedValue({}) })),
    PutObjectCommand: jest.fn(),
  }));
  jest.doMock('lambda-multipart-parser', () => ({
    __esModule: true,
    default: { parse: jest.fn().mockResolvedValue(multipartPayload) },
  }));

  global.fetch = jest.fn().mockResolvedValue({
    json: jest.fn().mockResolvedValue({ ok: true }),
  });

  const { handler } = require(handlerModulePath);
  const authorizer = createAuthorizer({ userId: authUserId, role: authRole, ngoId: authNgoId });

  return {
    handler,
    authorizer,
    petModel,
    userModel,
    eyeAnalysisModel,
    eyeDiseaseModel,
    imageCollectionModel,
    apiLogModel,
    rateLimitModel,
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

describe('pet-analysis handler Tier 2 integration', () => {
  test('returns 404 for unknown route', async () => {
    const { handler, authorizer } = loadHandlerWithMocks();
    const result = await handler(
      createEvent({
        method: 'GET',
        path: '/pet/analysis/not-found',
        resource: '/pet/analysis/not-found',
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(404);
    expect(parsed.body.errorKey).toBe('common.routeNotFound');
  });

  test('returns 405 for known path with unsupported method', async () => {
    const { handler, authorizer } = loadHandlerWithMocks();
    const result = await handler(
      createEvent({
        method: 'GET',
        path: '/pet/analysis/breed',
        resource: '/pet/analysis/breed',
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(405);
    expect(parsed.body.errorKey).toBe('common.methodNotAllowed');
  });

  test('GET eye disease allows public access and returns disease details', async () => {
    const { handler } = loadHandlerWithMocks({
      eyeDiseaseDoc: {
        eyeDisease_eng: 'Cataract',
        eyeDisease_chi: '白內障',
      },
    });

    const result = await handler(
      createEvent({
        method: 'GET',
        path: '/pet/analysis/eye/Cataract',
        resource: '/pet/analysis/eye/{identifier}',
        pathParameters: { identifier: 'Cataract' },
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(201);
    expect(parsed.body.success).toBe(true);
    expect(parsed.body.result.eyeDisease_eng).toBe('Cataract');
  });

  test('GET eye log requires auth when identifier is petId', async () => {
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler } = loadHandlerWithMocks({ petDoc: { _id: petId, userId: petId } });

    const result = await handler(
      createEvent({
        method: 'GET',
        path: `/pet/analysis/eye/${petId}`,
        resource: '/pet/analysis/eye/{identifier}',
        pathParameters: { identifier: petId },
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(401);
    expect(parsed.body.errorKey).toBe('common.unauthorized');
  });

  test('POST breed rejects missing body fields', async () => {
    const { handler, authorizer } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/pet/analysis/breed',
        resource: '/pet/analysis/breed',
        body: JSON.stringify({ species: '' }),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('petAnalysis.errors.speciesRequired');
  });

  test('PATCH eye returns 400 for invalid image URL format', async () => {
    const authUserId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId,
      petDoc: { _id: petId, userId: authUserId, deleted: false },
    });

    const result = await handler(
      createEvent({
        method: 'PATCH',
        path: `/pet/analysis/eye/${petId}`,
        resource: '/pet/analysis/eye/{petId}',
        pathParameters: { petId },
        body: JSON.stringify({
          petId,
          date: '2024-01-01',
          leftEyeImage1PublicAccessUrl: 'not-a-url',
          rightEyeImage1PublicAccessUrl: 'https://valid.example/right.jpg',
        }),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('petAnalysis.errors.updatePetEye.invalidImageUrlFormat');
  });

  test('POST uploads/breed-image blocks path traversal folder attempts', async () => {
    const { handler, authorizer } = loadHandlerWithMocks({
      multipartPayload: {
        url: 'breed_analysis/../secret',
        files: [
          {
            contentType: 'image/jpeg',
            content: Buffer.from('image-data'),
            filename: 'eye.jpg',
          },
        ],
      },
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/pet/analysis/uploads/breed-image',
        resource: '/pet/analysis/uploads/breed-image',
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('petAnalysis.errors.invalidFolder');
  });
});

describe('GET /pet/analysis/eye/{identifier}', () => {
  test('returns 201 with null fields for Normal eye disease when not in DB', async () => {
    const { handler } = loadHandlerWithMocks({ eyeDiseaseDoc: null });

    const result = await handler(
      createEvent({
        method: 'GET',
        path: '/pet/analysis/eye/Normal',
        resource: '/pet/analysis/eye/{identifier}',
        pathParameters: { identifier: 'Normal' },
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(201);
    expect(parsed.body.result.eyeDiseaseEng).toBeNull();
    expect(parsed.body.result.id).toBeNull();
  });

  test('returns 404 when eye disease name is not found', async () => {
    const { handler } = loadHandlerWithMocks({ eyeDiseaseDoc: null });

    const result = await handler(
      createEvent({
        method: 'GET',
        path: '/pet/analysis/eye/UnknownDisease',
        resource: '/pet/analysis/eye/{identifier}',
        pathParameters: { identifier: 'UnknownDisease' },
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(404);
    expect(parsed.body.errorKey).toBe('petAnalysis.errors.eyeDiseaseNotFound');
  });

  test('returns 400 when identifier is missing/empty', async () => {
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'GET',
        path: '/pet/analysis/eye/',
        resource: '/pet/analysis/eye/{identifier}',
        pathParameters: { identifier: '' },
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('petAnalysis.errors.missingEyeDiseaseName');
  });

  test('returns eye log list when caller owns the pet', async () => {
    const authUserId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const logEntry = { _id: new mongoose.Types.ObjectId().toString(), petId, image: 'https://img.example', eyeSide: 'left', result: { disease: 'Normal' }, createdAt: new Date().toISOString() };

    const { handler, authorizer, eyeAnalysisModel } = loadHandlerWithMocks({
      authUserId,
      petDoc: { _id: petId, userId: authUserId, deleted: false },
    });
    eyeAnalysisModel.find.mockImplementationOnce(() => ({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([logEntry]),
    }));

    const result = await handler(
      createEvent({
        method: 'GET',
        path: `/pet/analysis/eye/${petId}`,
        resource: '/pet/analysis/eye/{identifier}',
        pathParameters: { identifier: petId },
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(200);
    expect(Array.isArray(parsed.body.result)).toBe(true);
    expect(parsed.body.result[0].petId).toBe(petId);
  });

  test('returns 403 when caller does not own the pet', async () => {
    const authUserId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const otherUserId = new mongoose.Types.ObjectId().toString();

    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId,
      petDoc: { _id: petId, userId: otherUserId, ngoId: null, deleted: false },
    });

    const result = await handler(
      createEvent({
        method: 'GET',
        path: `/pet/analysis/eye/${petId}`,
        resource: '/pet/analysis/eye/{identifier}',
        pathParameters: { identifier: petId },
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(403);
  });

  test('returns eye log when NGO owns the pet', async () => {
    const authNgoId = new mongoose.Types.ObjectId().toString();
    const authUserId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const petOwnerUserId = new mongoose.Types.ObjectId().toString();

    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId,
      authRole: 'ngo',
      authNgoId,
      petDoc: { _id: petId, userId: petOwnerUserId, ngoId: authNgoId, deleted: false },
    });

    const result = await handler(
      createEvent({
        method: 'GET',
        path: `/pet/analysis/eye/${petId}`,
        resource: '/pet/analysis/eye/{identifier}',
        pathParameters: { identifier: petId },
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(200);
  });
});

describe('POST /pet/analysis/eye/{petId}', () => {
  test('returns 401 when no auth context', async () => {
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'POST',
        path: `/pet/analysis/eye/${petId}`,
        resource: '/pet/analysis/eye/{petId}',
        pathParameters: { petId },
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(401);
    expect(parsed.body.errorKey).toBe('common.unauthorized');
  });

  test('returns 400 for invalid petId format in path', async () => {
    const { handler, authorizer } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/pet/analysis/eye/not-a-valid-id',
        resource: '/pet/analysis/eye/{petId}',
        pathParameters: { petId: 'not-a-valid-id' },
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('petAnalysis.errors.invalidObjectId');
  });

  test('returns 404 when caller user is not found', async () => {
    const authUserId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId,
      userDoc: null,
      petDoc: { _id: petId, userId: authUserId, deleted: false },
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: `/pet/analysis/eye/${petId}`,
        resource: '/pet/analysis/eye/{petId}',
        pathParameters: { petId },
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(404);
    expect(parsed.body.errorKey).toBe('petAnalysis.errors.userNotFound');
  });

  test('returns 404 when pet is not found', async () => {
    const authUserId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId,
      petDoc: null,
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: `/pet/analysis/eye/${petId}`,
        resource: '/pet/analysis/eye/{petId}',
        pathParameters: { petId },
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(404);
    expect(parsed.body.errorKey).toBe('petAnalysis.errors.petNotFound');
  });

  test('returns 403 when caller does not own the pet', async () => {
    const authUserId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const otherUserId = new mongoose.Types.ObjectId().toString();
    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId,
      petDoc: { _id: petId, userId: otherUserId, ngoId: null, deleted: false },
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: `/pet/analysis/eye/${petId}`,
        resource: '/pet/analysis/eye/{petId}',
        pathParameters: { petId },
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(403);
  });

  test('returns 400 when both image_url and file are absent', async () => {
    const authUserId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId,
      petDoc: { _id: petId, userId: authUserId, deleted: false },
      multipartPayload: { files: [] },
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: `/pet/analysis/eye/${petId}`,
        resource: '/pet/analysis/eye/{petId}',
        pathParameters: { petId },
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('petAnalysis.errors.missingArguments');
  });

  test('returns 400 when uploaded file has unsupported content type', async () => {
    const authUserId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId,
      petDoc: { _id: petId, userId: authUserId, deleted: false },
      multipartPayload: {
        files: [{ contentType: 'application/pdf', content: Buffer.from('data'), filename: 'eye.pdf' }],
      },
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: `/pet/analysis/eye/${petId}`,
        resource: '/pet/analysis/eye/{petId}',
        pathParameters: { petId },
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('petAnalysis.errors.unsupportedFormat');
  });

  test('returns 413 when uploaded file exceeds 30MB', async () => {
    const authUserId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const bigBuffer = Buffer.alloc(31 * 1024 * 1024);
    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId,
      petDoc: { _id: petId, userId: authUserId, deleted: false },
      multipartPayload: {
        files: [{ contentType: 'image/jpeg', content: bigBuffer, filename: 'large.jpg' }],
      },
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: `/pet/analysis/eye/${petId}`,
        resource: '/pet/analysis/eye/{petId}',
        pathParameters: { petId },
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(413);
    expect(parsed.body.errorKey).toBe('petAnalysis.errors.fileTooLarge');
  });

  test('returns 413 when uploaded file is empty (zero bytes)', async () => {
    const authUserId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId,
      petDoc: { _id: petId, userId: authUserId, deleted: false },
      multipartPayload: {
        files: [{ contentType: 'image/jpeg', content: Buffer.alloc(0), filename: 'empty.jpg' }],
      },
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: `/pet/analysis/eye/${petId}`,
        resource: '/pet/analysis/eye/{petId}',
        pathParameters: { petId },
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(413);
    expect(parsed.body.errorKey).toBe('petAnalysis.errors.fileTooSmall');
  });

  test('returns 200 with analysis result on happy path with image URL', async () => {
    const authUserId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId,
      petDoc: { _id: petId, userId: authUserId, deleted: false },
      multipartPayload: { files: [], image_url: 'https://example.com/eye.jpg' },
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: `/pet/analysis/eye/${petId}`,
        resource: '/pet/analysis/eye/{petId}',
        pathParameters: { petId },
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(200);
    expect(parsed.body.result).toBeDefined();
    expect(parsed.body.request_id).toBeDefined();
  });

  test('returns 429 when rate limit is exceeded', async () => {
    const authUserId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler, authorizer, rateLimitModel } = loadHandlerWithMocks({
      authUserId,
      petDoc: { _id: petId, userId: authUserId, deleted: false },
      multipartPayload: { files: [], image_url: 'https://example.com/eye.jpg' },
    });
    rateLimitModel.findOneAndUpdate.mockResolvedValueOnce({
      count: 11,
      expireAt: new Date(Date.now() + 300_000),
      windowStart: new Date(),
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: `/pet/analysis/eye/${petId}`,
        resource: '/pet/analysis/eye/{petId}',
        pathParameters: { petId },
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(429);
    expect(parsed.body.errorKey).toBe('common.rateLimited');
  });
});

describe('PATCH /pet/analysis/eye/{petId}', () => {
  const validDate = '2024-06-01';
  const validLeft = 'https://bucket.example/left.jpg';
  const validRight = 'https://bucket.example/right.jpg';

  test('returns 401 when no auth context', async () => {
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'PATCH',
        path: `/pet/analysis/eye/${petId}`,
        resource: '/pet/analysis/eye/{petId}',
        pathParameters: { petId },
        body: JSON.stringify({ petId, date: validDate, leftEyeImage1PublicAccessUrl: validLeft, rightEyeImage1PublicAccessUrl: validRight }),
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(401);
  });

  test('returns 400 for missing required body fields', async () => {
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler, authorizer } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'PATCH',
        path: `/pet/analysis/eye/${petId}`,
        resource: '/pet/analysis/eye/{petId}',
        pathParameters: { petId },
        body: JSON.stringify({ petId }),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('petAnalysis.errors.updatePetEye.missingRequiredFields');
  });

  test('returns 400 when body petId does not match path petId', async () => {
    const petId = new mongoose.Types.ObjectId().toString();
    const differentPetId = new mongoose.Types.ObjectId().toString();
    const { handler, authorizer } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'PATCH',
        path: `/pet/analysis/eye/${petId}`,
        resource: '/pet/analysis/eye/{petId}',
        pathParameters: { petId },
        body: JSON.stringify({ petId: differentPetId, date: validDate, leftEyeImage1PublicAccessUrl: validLeft, rightEyeImage1PublicAccessUrl: validRight }),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('petAnalysis.errors.updatePetEye.invalidPetIdFormat');
  });

  test('returns 400 for invalid date format', async () => {
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler, authorizer } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'PATCH',
        path: `/pet/analysis/eye/${petId}`,
        resource: '/pet/analysis/eye/{petId}',
        pathParameters: { petId },
        body: JSON.stringify({ petId, date: 'not-a-date', leftEyeImage1PublicAccessUrl: validLeft, rightEyeImage1PublicAccessUrl: validRight }),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('petAnalysis.errors.updatePetEye.invalidDateFormat');
  });

  test('returns 404 when pet does not exist', async () => {
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler, authorizer } = loadHandlerWithMocks({ petDoc: null });

    const result = await handler(
      createEvent({
        method: 'PATCH',
        path: `/pet/analysis/eye/${petId}`,
        resource: '/pet/analysis/eye/{petId}',
        pathParameters: { petId },
        body: JSON.stringify({ petId, date: validDate, leftEyeImage1PublicAccessUrl: validLeft, rightEyeImage1PublicAccessUrl: validRight }),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(404);
    expect(parsed.body.errorKey).toBe('petAnalysis.errors.updatePetEye.petNotFound');
  });

  test('returns 410 when pet is deleted', async () => {
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler, authorizer } = loadHandlerWithMocks({ petDoc: { _id: petId, deleted: true } });

    const result = await handler(
      createEvent({
        method: 'PATCH',
        path: `/pet/analysis/eye/${petId}`,
        resource: '/pet/analysis/eye/{petId}',
        pathParameters: { petId },
        body: JSON.stringify({ petId, date: validDate, leftEyeImage1PublicAccessUrl: validLeft, rightEyeImage1PublicAccessUrl: validRight }),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(410);
    expect(parsed.body.errorKey).toBe('petAnalysis.errors.updatePetEye.petDeleted');
  });

  test('returns 403 when caller does not own the pet', async () => {
    const petId = new mongoose.Types.ObjectId().toString();
    const otherUserId = new mongoose.Types.ObjectId().toString();
    const { handler, authorizer } = loadHandlerWithMocks({ petDoc: { _id: petId, userId: otherUserId, deleted: false } });

    const result = await handler(
      createEvent({
        method: 'PATCH',
        path: `/pet/analysis/eye/${petId}`,
        resource: '/pet/analysis/eye/{petId}',
        pathParameters: { petId },
        body: JSON.stringify({ petId, date: validDate, leftEyeImage1PublicAccessUrl: validLeft, rightEyeImage1PublicAccessUrl: validRight }),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(403);
  });

  test('returns 201 with updated pet on happy path', async () => {
    const authUserId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const updatedPet = { _id: petId, userId: authUserId, name: 'TestPet', animal: 'dog', sex: 'male', eyeimages: [{ date: new Date(), eyeimage_left1: validLeft, eyeimage_right1: validRight }] };
    const { handler, authorizer, petModel } = loadHandlerWithMocks({
      authUserId,
      petDoc: { _id: petId, userId: authUserId, deleted: false },
      petFindOneAndUpdateResult: updatedPet,
    });

    const result = await handler(
      createEvent({
        method: 'PATCH',
        path: `/pet/analysis/eye/${petId}`,
        resource: '/pet/analysis/eye/{petId}',
        pathParameters: { petId },
        body: JSON.stringify({ petId, date: validDate, leftEyeImage1PublicAccessUrl: validLeft, rightEyeImage1PublicAccessUrl: validRight }),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(201);
    expect(parsed.body.result.userId).toBe(authUserId);
  });
});

describe('POST /pet/analysis/breed', () => {
  test('returns 200 with breed result on happy path', async () => {
    const authUserId = new mongoose.Types.ObjectId().toString();
    const { handler, authorizer } = loadHandlerWithMocks({ authUserId });

    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ breed: 'Labrador', confidence: 0.95 }),
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/pet/analysis/breed',
        resource: '/pet/analysis/breed',
        body: JSON.stringify({ species: 'dog', url: 'https://example.com/pet.jpg' }),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(200);
    expect(parsed.body.result).toBeDefined();
  });

  test('returns 401 when no auth context', async () => {
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/pet/analysis/breed',
        resource: '/pet/analysis/breed',
        body: JSON.stringify({ species: 'dog', url: 'https://example.com/pet.jpg' }),
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(401);
  });

  test('returns 400 for missing url field', async () => {
    const { handler, authorizer } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/pet/analysis/breed',
        resource: '/pet/analysis/breed',
        body: JSON.stringify({ species: 'dog' }),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('petAnalysis.errors.urlRequired');
  });

  test('returns 400 for invalid URL format in url field', async () => {
    const { handler, authorizer } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/pet/analysis/breed',
        resource: '/pet/analysis/breed',
        body: JSON.stringify({ species: 'dog', url: 'not-a-url' }),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('petAnalysis.errors.invalidUrl');
  });

  test('returns 400 for unknown extra fields (mass-assignment prevention)', async () => {
    const { handler, authorizer } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/pet/analysis/breed',
        resource: '/pet/analysis/breed',
        body: JSON.stringify({ species: 'dog', url: 'https://example.com/pet.jpg', role: 'admin', injected: true }),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('petAnalysis.errors.unknownField');
  });

  test('returns 400 for malformed JSON body', async () => {
    const { handler, authorizer } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/pet/analysis/breed',
        resource: '/pet/analysis/breed',
        body: '{ invalid-json',
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
  });
});

describe('POST /pet/analysis/uploads/image', () => {
  test('returns 401 when no auth context', async () => {
    const { handler } = loadHandlerWithMocks({
      multipartPayload: { files: [{ contentType: 'image/jpeg', content: Buffer.from('data'), която: 'img.jpg' }] },
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/pet/analysis/uploads/image',
        resource: '/pet/analysis/uploads/image',
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(401);
  });

  test('returns 400 when no files uploaded', async () => {
    const { handler, authorizer } = loadHandlerWithMocks({ multipartPayload: { files: [] } });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/pet/analysis/uploads/image',
        resource: '/pet/analysis/uploads/image',
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('petAnalysis.errors.noFilesUploaded');
  });

  test('returns 400 when more than one file is uploaded', async () => {
    const file = { contentType: 'image/jpeg', content: Buffer.from('data'), filename: 'img.jpg' };
    const { handler, authorizer } = loadHandlerWithMocks({ multipartPayload: { files: [file, file] } });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/pet/analysis/uploads/image',
        resource: '/pet/analysis/uploads/image',
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('petAnalysis.errors.tooManyFiles');
  });

  test('returns 400 for unsupported file content type', async () => {
    const { handler, authorizer } = loadHandlerWithMocks({
      multipartPayload: { files: [{ contentType: 'image/gif', content: Buffer.from('data'), filename: 'img.gif' }] },
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/pet/analysis/uploads/image',
        resource: '/pet/analysis/uploads/image',
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('petAnalysis.errors.invalidImageFormat');
  });

  test('returns 200 with url on happy path', async () => {
    const { handler, authorizer } = loadHandlerWithMocks({
      multipartPayload: { files: [{ contentType: 'image/jpeg', content: Buffer.from('imgdata'), filename: 'eye.jpg' }] },
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/pet/analysis/uploads/image',
        resource: '/pet/analysis/uploads/image',
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(200);
    expect(typeof parsed.body.url).toBe('string');
    expect(parsed.body.url).toMatch(/^https:/);
  });
});

describe('POST /pet/analysis/uploads/breed-image', () => {
  test('returns 401 when no auth context', async () => {
    const { handler } = loadHandlerWithMocks({
      multipartPayload: { url: 'breed_analysis', files: [{ contentType: 'image/jpeg', content: Buffer.from('data'), filename: 'img.jpg' }] },
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/pet/analysis/uploads/breed-image',
        resource: '/pet/analysis/uploads/breed-image',
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(401);
  });

  test('returns 400 when no file uploaded', async () => {
    const { handler, authorizer } = loadHandlerWithMocks({ multipartPayload: { url: 'breed_analysis', files: [] } });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/pet/analysis/uploads/breed-image',
        resource: '/pet/analysis/uploads/breed-image',
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('petAnalysis.errors.noFilesUploaded');
  });

  test('returns 400 for unsupported file type', async () => {
    const { handler, authorizer } = loadHandlerWithMocks({
      multipartPayload: { url: 'breed_analysis', files: [{ contentType: 'image/tiff', content: Buffer.from('data'), filename: 'img.tif' }] },
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/pet/analysis/uploads/breed-image',
        resource: '/pet/analysis/uploads/breed-image',
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('petAnalysis.errors.invalidImageFormat');
  });

  test('returns 400 for empty folder path', async () => {
    const { handler, authorizer } = loadHandlerWithMocks({
      multipartPayload: { url: '', files: [{ contentType: 'image/jpeg', content: Buffer.from('data'), filename: 'img.jpg' }] },
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/pet/analysis/uploads/breed-image',
        resource: '/pet/analysis/uploads/breed-image',
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('petAnalysis.errors.invalidFolder');
  });

  test('returns 400 for disallowed folder prefix', async () => {
    const { handler, authorizer } = loadHandlerWithMocks({
      multipartPayload: { url: '/etc/passwd', files: [{ contentType: 'image/jpeg', content: Buffer.from('data'), filename: 'img.jpg' }] },
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/pet/analysis/uploads/breed-image',
        resource: '/pet/analysis/uploads/breed-image',
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('petAnalysis.errors.invalidFolder');
  });

  test('returns 200 with url on happy path with allowed prefix', async () => {
    const { handler, authorizer } = loadHandlerWithMocks({
      multipartPayload: { url: 'breed_analysis/run1', files: [{ contentType: 'image/jpeg', content: Buffer.from('imgdata'), filename: 'pet.jpg' }] },
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/pet/analysis/uploads/breed-image',
        resource: '/pet/analysis/uploads/breed-image',
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(200);
    expect(typeof parsed.body.url).toBe('string');
  });
});

describe('CORS and OPTIONS behavior', () => {
  test('OPTIONS /pet/analysis/eye/{proxy+} returns 204 with CORS headers for allowed origin', async () => {
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'OPTIONS',
        path: '/pet/analysis/eye/some-identifier',
        resource: '/pet/analysis/eye/{proxy+}',
        headers: { Origin: '*' },
      }),
      createContext()
    );

    expect(result.statusCode).toBe(204);
  });

  test('OPTIONS /pet/analysis/breed returns 204 for allowed origin', async () => {
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'OPTIONS',
        path: '/pet/analysis/breed',
        resource: '/pet/analysis/breed',
        headers: { Origin: '*' },
      }),
      createContext()
    );

    expect(result.statusCode).toBe(204);
  });
});

describe('Cyberattack and abuse cases', () => {
  test('GET eye - NoSQL operator injected as identifier is treated as disease name (no ObjectId)', async () => {
    const { handler } = loadHandlerWithMocks({ eyeDiseaseDoc: null });

    const result = await handler(
      createEvent({
        method: 'GET',
        path: '/pet/analysis/eye/%7B%24gt%3A%22%22%7D',
        resource: '/pet/analysis/eye/{identifier}',
        pathParameters: { identifier: '{"$gt":""}' },
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    // Non-ObjectId identifier goes to eye disease path → not found → 404
    expect(parsed.statusCode).toBe(404);
    expect(parsed.body.errorKey).toBe('petAnalysis.errors.eyeDiseaseNotFound');
  });

  test('PATCH eye - unknown extra fields are rejected by strict schema', async () => {
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler, authorizer } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'PATCH',
        path: `/pet/analysis/eye/${petId}`,
        resource: '/pet/analysis/eye/{petId}',
        pathParameters: { petId },
        body: JSON.stringify({
          petId,
          date: '2024-01-01',
          leftEyeImage1PublicAccessUrl: 'https://bucket.example/l.jpg',
          rightEyeImage1PublicAccessUrl: 'https://bucket.example/r.jpg',
          role: 'admin',
        }),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    // strict() schema rejects unknown fields
    expect(parsed.statusCode).toBe(400);
  });

  test('POST eye - petId in path that looks like NoSQL injection returns 400', async () => {
    const { handler, authorizer } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/pet/analysis/eye/%7B%24ne%3Anull%7D',
        resource: '/pet/analysis/eye/{petId}',
        pathParameters: { petId: '{"$ne":null}' },
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('petAnalysis.errors.invalidObjectId');
  });

  test('POST breed - species field with very long value is rejected', async () => {
    const { handler, authorizer } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/pet/analysis/breed',
        resource: '/pet/analysis/breed',
        body: JSON.stringify({ species: 'x'.repeat(101), url: 'https://example.com/pet.jpg' }),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('petAnalysis.errors.fieldTooLong');
  });

  test('POST uploads/breed-image - path traversal with encoded dots is blocked', async () => {
    const { handler, authorizer } = loadHandlerWithMocks({
      multipartPayload: {
        url: 'breed_analysis/./../../etc/secret',
        files: [{ contentType: 'image/jpeg', content: Buffer.from('data'), filename: 'img.jpg' }],
      },
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/pet/analysis/uploads/breed-image',
        resource: '/pet/analysis/uploads/breed-image',
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('petAnalysis.errors.invalidFolder');
  });
});
