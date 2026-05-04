const path = require('path');
const mongoose = require('mongoose');

const handlerModulePath = path.resolve(__dirname, '../dist/functions/pet-source/index.js');
const sharedRuntimeModulePath = path.resolve(
  __dirname,
  '../dist/layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/index.js'
);

function createContext() {
  return {
    awsRequestId: 'req-tier2-pet-source-handler',
    callbackWaitsForEmptyEventLoop: true,
  };
}

function createAuthorizer({
  userId = new mongoose.Types.ObjectId().toString(),
  role = 'user',
  ngoId,
} = {}) {
  const authorizer = {
    userId,
    principalId: userId,
    userRole: role,
  };

  if (ngoId !== undefined) {
    authorizer.ngoId = ngoId;
  }

  return authorizer;
}

function createEvent({
  method = 'GET',
  path = '/pet/source/placeholder',
  resource = '/pet/source/{petId}',
  body = null,
  authorizer,
  headers = {},
  pathParameters = null,
} = {}) {
  return {
    httpMethod: method,
    path,
    resource,
    headers,
    body,
    pathParameters,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    multiValueHeaders: {},
    stageVariables: null,
    requestContext: {
      requestId: 'req-tier2-pet-source-handler',
      authorizer: authorizer || undefined,
      identity: {
        sourceIp: '198.51.100.10',
      },
    },
    isBase64Encoded: false,
  };
}

function createLeanResult(value) {
  return {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(value),
  };
}

function parseResponse(result) {
  return {
    statusCode: result.statusCode,
    headers: result.headers,
    body: result.body ? JSON.parse(result.body) : null,
  };
}

function buildSourceDocument(overrides = {}) {
  const sourceId = new mongoose.Types.ObjectId().toString();
  const petId = new mongoose.Types.ObjectId().toString();
  return {
    _id: sourceId,
    petId,
    placeofOrigin: 'Street rescue',
    channel: 'Volunteer',
    rescueCategory: ['injured'],
    causeOfInjury: 'Leg wound',
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-01-02T00:00:00.000Z'),
    toObject: () => ({
      _id: sourceId,
      petId,
      placeofOrigin: 'Street rescue',
      channel: 'Volunteer',
      rescueCategory: ['injured'],
      causeOfInjury: 'Leg wound',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-02T00:00:00.000Z'),
      ...overrides,
    }),
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
  delete process.env.AWS_SAM_LOCAL;

  Object.assign(process.env, overrides);
}

function loadHandlerWithMocks({
  authUserId = new mongoose.Types.ObjectId().toString(),
  authRole = 'user',
  authNgoId,
  envOverrides = {},
  petDoc = null,
  sourceDoc = null,
  sourceCreateResult = buildSourceDocument(),
  sourceCreateError = null,
  sourceUpdateResult = { matchedCount: 1 },
  connectError = null,
} = {}) {
  jest.resetModules();
  jest.clearAllMocks();
  resetEnv(envOverrides);

  const actualMongoose = jest.requireActual('mongoose');

  const petModel = {
    findOne: jest.fn(() => createLeanResult(petDoc)),
  };

  const sourceModel = {
    findOne: jest.fn(() => createLeanResult(sourceDoc)),
    create: sourceCreateError
      ? jest.fn().mockRejectedValue(sourceCreateError)
      : jest.fn().mockResolvedValue(sourceCreateResult),
    updateOne: jest.fn().mockResolvedValue(sourceUpdateResult),
  };

  const mongooseMock = {
    Schema: actualMongoose.Schema,
    Types: actualMongoose.Types,
    connection: { readyState: connectError ? 0 : 1 },
    connect: connectError ? jest.fn().mockRejectedValue(connectError) : jest.fn().mockResolvedValue({}),
    models: {},
    isValidObjectId: actualMongoose.isValidObjectId,
    model: jest.fn((name) => {
      if (name === 'Pet') return petModel;
      if (name === 'pet_sources') return sourceModel;
      throw new Error(`Unexpected model ${name}`);
    }),
  };

  jest.doMock('mongoose', () => ({
    __esModule: true,
    default: mongooseMock,
  }));

  jest.doMock('@aws-ddd-api/shared', () => require(sharedRuntimeModulePath), { virtual: true });

  const { handler } = require(handlerModulePath);
  const authorizer = createAuthorizer({
    userId: authUserId,
    role: authRole,
    ngoId: authNgoId,
  });

  return {
    handler,
    authorizer,
    petModel,
    sourceModel,
    mongooseMock,
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

describe('pet-source handler Tier 2 integration', () => {
  test('returns 404 for unknown route', async () => {
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'GET',
        path: '/pet/source/extra/path',
        resource: '/pet/source/extra/path',
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(404);
    expect(parsed.body.errorKey).toBe('common.routeNotFound');
  });

  test('returns 405 for wrong method on known path', async () => {
    const { handler } = loadHandlerWithMocks();
    const petId = new mongoose.Types.ObjectId().toString();

    const result = await handler(
      createEvent({
        method: 'PUT',
        path: `/pet/source/${petId}`,
        resource: '/pet/source/{petId}',
        pathParameters: { petId },
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(405);
    expect(parsed.body.errorKey).toBe('common.methodNotAllowed');
  });

  test('returns 401 when authorizer context is missing on a protected route', async () => {
    const { handler } = loadHandlerWithMocks();
    const petId = new mongoose.Types.ObjectId().toString();

    const result = await handler(
      createEvent({
        method: 'GET',
        path: `/pet/source/${petId}`,
        resource: '/pet/source/{petId}',
        pathParameters: { petId },
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(401);
    expect(parsed.body.errorKey).toBe('common.unauthorized');
  });

  test('handles allowed CORS preflight requests with 204', async () => {
    const { handler } = loadHandlerWithMocks();
    const petId = new mongoose.Types.ObjectId().toString();

    const result = await handler(
      createEvent({
        method: 'OPTIONS',
        path: `/pet/source/${petId}`,
        resource: '/pet/source/{petId}',
        headers: { origin: 'https://app.example.test' },
        pathParameters: { petId },
      }),
      createContext()
    );

    expect(result.statusCode).toBe(204);
    expect(result.body).toBe('');
    expect(result.headers['Access-Control-Allow-Origin']).toBe('*');
  });

  test('normalizes infrastructure failures to 500', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler } = loadHandlerWithMocks({
      authUserId: userId,
      connectError: new Error('mongo down'),
    });

    const result = await handler(
      createEvent({
        method: 'GET',
        path: `/pet/source/${petId}`,
        resource: '/pet/source/{petId}',
        pathParameters: { petId },
        authorizer: createAuthorizer({ userId }),
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(500);
    expect(parsed.body.errorKey).toBe('common.internalError');
  });

  test('returns 200 with form null when the pet has no source record', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler } = loadHandlerWithMocks({
      authUserId: userId,
      petDoc: { _id: petId, userId, deleted: false },
      sourceDoc: null,
    });

    const result = await handler(
      createEvent({
        method: 'GET',
        path: `/pet/source/${petId}`,
        resource: '/pet/source/{petId}',
        pathParameters: { petId },
        authorizer: createAuthorizer({ userId }),
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(200);
    expect(parsed.body.form).toBeNull();
    expect(parsed.body.petId).toBe(petId);
  });

  test('creates a pet source record successfully', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const created = buildSourceDocument({ petId });
    const { handler, sourceModel } = loadHandlerWithMocks({
      authUserId: userId,
      petDoc: { _id: petId, userId, deleted: false },
      sourceDoc: null,
      sourceCreateResult: created,
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: `/pet/source/${petId}`,
        resource: '/pet/source/{petId}',
        pathParameters: { petId },
        authorizer: createAuthorizer({ userId }),
        body: JSON.stringify({
          placeofOrigin: 'Shelter',
          channel: 'Referral',
          rescueCategory: ['injured'],
        }),
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(201);
    expect(parsed.body.petId).toBe(petId);
    expect(parsed.body.sourceId).toBe(String(created._id));
    expect(sourceModel.create).toHaveBeenCalledWith({
      petId,
      placeofOrigin: 'Shelter',
      channel: 'Referral',
      rescueCategory: ['injured'],
      causeOfInjury: null,
    });
  });

  test('returns 409 on duplicate source create', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const existing = buildSourceDocument({ petId });
    const { handler, sourceModel } = loadHandlerWithMocks({
      authUserId: userId,
      petDoc: { _id: petId, userId, deleted: false },
      sourceDoc: existing,
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: `/pet/source/${petId}`,
        resource: '/pet/source/{petId}',
        pathParameters: { petId },
        authorizer: createAuthorizer({ userId }),
        body: JSON.stringify({
          placeofOrigin: 'Shelter',
        }),
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(409);
    expect(parsed.body.errorKey).toBe('petSource.errors.duplicateRecord');
    expect(sourceModel.create).not.toHaveBeenCalled();
  });

  test('returns 400 for malformed JSON bodies', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler } = loadHandlerWithMocks({
      authUserId: userId,
      petDoc: { _id: petId, userId, deleted: false },
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: `/pet/source/${petId}`,
        resource: '/pet/source/{petId}',
        pathParameters: { petId },
        authorizer: createAuthorizer({ userId }),
        body: '{"placeofOrigin"',
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    // The pet-source service no longer overrides malformedJsonErrorKey, so the
    // shared parseBody default applies.
    expect(parsed.body.errorKey).toBe('common.invalidBodyParams');
  });

  test('returns 400 when create omits both placeofOrigin and channel', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler } = loadHandlerWithMocks({
      authUserId: userId,
      petDoc: { _id: petId, userId, deleted: false },
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: `/pet/source/${petId}`,
        resource: '/pet/source/{petId}',
        pathParameters: { petId },
        authorizer: createAuthorizer({ userId }),
        body: JSON.stringify({
          rescueCategory: ['injured'],
        }),
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('petSource.errors.missingRequiredFields');
  });

  test('returns 403 when a stranger tries to read another pet source record', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const ownerId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler } = loadHandlerWithMocks({
      authUserId: userId,
      petDoc: { _id: petId, userId: ownerId, deleted: false },
    });

    const result = await handler(
      createEvent({
        method: 'GET',
        path: `/pet/source/${petId}`,
        resource: '/pet/source/{petId}',
        pathParameters: { petId },
        authorizer: createAuthorizer({ userId }),
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(403);
    expect(parsed.body.errorKey).toBe('common.forbidden');
  });

  test('returns 400 on PATCH with extra mass-assignment fields', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler, sourceModel } = loadHandlerWithMocks({
      authUserId: userId,
      petDoc: { _id: petId, userId, deleted: false },
      sourceDoc: buildSourceDocument({ petId }),
    });

    const result = await handler(
      createEvent({
        method: 'PATCH',
        path: `/pet/source/${petId}`,
        resource: '/pet/source/{petId}',
        pathParameters: { petId },
        authorizer: createAuthorizer({ userId }),
        body: JSON.stringify({
          placeofOrigin: 'Clinic handoff',
          deleted: true,
        }),
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('common.invalidBodyParams');
    expect(sourceModel.updateOne).not.toHaveBeenCalled();
  });

  test('returns 404 when PATCH cannot find an existing source record for the pet', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler, sourceModel } = loadHandlerWithMocks({
      authUserId: userId,
      petDoc: { _id: petId, userId, deleted: false },
      sourceDoc: null,
    });

    const result = await handler(
      createEvent({
        method: 'PATCH',
        path: `/pet/source/${petId}`,
        resource: '/pet/source/{petId}',
        pathParameters: { petId },
        authorizer: createAuthorizer({ userId }),
        body: JSON.stringify({
          placeofOrigin: 'Clinic handoff',
        }),
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(404);
    expect(parsed.body.errorKey).toBe('petSource.errors.recordNotFound');
    expect(sourceModel.updateOne).not.toHaveBeenCalled();
  });

  test('updates a pet source record by petId and returns the current sourceId', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const existing = buildSourceDocument({ petId });
    const { handler, sourceModel } = loadHandlerWithMocks({
      authUserId: userId,
      petDoc: { _id: petId, userId, deleted: false },
      sourceDoc: existing,
      sourceUpdateResult: { matchedCount: 1 },
    });

    const result = await handler(
      createEvent({
        method: 'PATCH',
        path: `/pet/source/${petId}`,
        resource: '/pet/source/{petId}',
        pathParameters: { petId },
        authorizer: createAuthorizer({ userId }),
        body: JSON.stringify({
          causeOfInjury: 'Recovered',
        }),
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(200);
    expect(parsed.body.petId).toBe(petId);
    expect(parsed.body.sourceId).toBe(String(existing._id));
    expect(sourceModel.updateOne).toHaveBeenCalledWith(
      { _id: String(existing._id), petId },
      { $set: { causeOfInjury: 'Recovered' } }
    );
  });
});
