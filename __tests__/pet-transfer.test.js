const path = require('path');
const mongoose = require('mongoose');

const handlerModulePath = path.resolve(__dirname, '../dist/functions/pet-transfer/index.js');
const sharedRuntimeModulePath = path.resolve(
  __dirname,
  '../dist/layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/index.js'
);

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createContext() {
  return {
    awsRequestId: 'req-tier2-pet-transfer-handler',
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
  method = 'POST',
  pathValue = '/pet/transfer/placeholder',
  resource = '/pet/transfer/{petId}',
  body = null,
  authorizer,
  headers = {},
  pathParameters = null,
} = {}) {
  return {
    httpMethod: method,
    path: pathValue,
    resource,
    headers,
    body,
    pathParameters,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    multiValueHeaders: {},
    stageVariables: null,
    requestContext: {
      requestId: 'req-tier2-pet-transfer-handler',
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

/**
 * Central mock loader.
 * - petFindOneResults: array of responses returned by petModel.findOne() in sequence.
 *   Position 0 is always the ownership check (authorizePetAccess).
 *   Position 1 (when present) is the sub-document existence check in updateTransfer.
 * - userFindOneResults: array of responses for User.findOne() (email lookup, phone lookup).
 */
function loadHandlerWithMocks({
  authUserId = new mongoose.Types.ObjectId().toString(),
  authRole = 'user',
  authNgoId,
  envOverrides = {},
  petFindOneResults = [],
  petUpdateOneResult = { matchedCount: 1 },
  userFindOneResults = [],
  connectError = null,
} = {}) {
  jest.resetModules();
  jest.clearAllMocks();
  resetEnv(envOverrides);

  const actualMongoose = jest.requireActual('mongoose');

  let petFindOneCallIndex = 0;
  let userFindOneCallIndex = 0;

  const petModel = {
    findOne: jest.fn(() => {
      const result = petFindOneResults[petFindOneCallIndex] ?? createLeanResult(null);
      petFindOneCallIndex++;
      return result;
    }),
    updateOne: jest.fn().mockResolvedValue(petUpdateOneResult),
  };

  const userModel = {
    findOne: jest.fn(() => {
      const result = userFindOneResults[userFindOneCallIndex] ?? createLeanResult(null);
      userFindOneCallIndex++;
      return result;
    }),
  };

  const mongooseMock = {
    Schema: actualMongoose.Schema,
    Types: actualMongoose.Types,
    connection: { readyState: connectError ? 0 : 1 },
    connect: connectError
      ? jest.fn().mockRejectedValue(connectError)
      : jest.fn().mockResolvedValue({}),
    models: {},
    isValidObjectId: actualMongoose.isValidObjectId,
    model: jest.fn((name) => {
      if (name === 'Pet') return petModel;
      if (name === 'User') return userModel;
      throw new Error(`Unexpected model: ${name}`);
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

  return { handler, authorizer, petModel, userModel, mongooseMock };
}

// ---------------------------------------------------------------------------
// Console suppression
// ---------------------------------------------------------------------------

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

// ===========================================================================
// Routing / infrastructure
// ===========================================================================

describe('pet-transfer handler — routing & infrastructure', () => {
  test('returns 404 for unregistered route', async () => {
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'GET',
        pathValue: '/pet/transfer/abc123/unknown-action',
        resource: '/pet/transfer/{petId}/unknown-action',
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(404);
    expect(parsed.body.errorKey).toBe('common.routeNotFound');
  });

  test('returns 401 when authorizer context is absent', async () => {
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'POST',
        pathValue: `/pet/transfer/${petId}`,
        resource: '/pet/transfer/{petId}',
        pathParameters: { petId },
        // no authorizer
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(401);
    expect(parsed.body.errorKey).toBe('common.unauthorized');
  });

  test('returns 204 for CORS OPTIONS preflight', async () => {
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'OPTIONS',
        pathValue: `/pet/transfer/${petId}`,
        resource: '/pet/transfer/{petId}',
        headers: { origin: 'https://app.example.test' },
        pathParameters: { petId },
      }),
      createContext()
    );

    expect(result.statusCode).toBe(204);
    expect(result.body).toBe('');
    expect(result.headers['Access-Control-Allow-Origin']).toBe('*');
  });

  test('returns 405 for wrong method on a known path', async () => {
    const petId = new mongoose.Types.ObjectId().toString();
    const transferId = new mongoose.Types.ObjectId().toString();
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'PUT',
        pathValue: `/pet/transfer/${petId}/${transferId}`,
        resource: '/pet/transfer/{petId}/{transferId}',
        pathParameters: { petId, transferId },
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(405);
    expect(parsed.body.errorKey).toBe('common.methodNotAllowed');
  });

  test('returns 204 for CORS OPTIONS preflight on /{petId}/{transferId}', async () => {
    const petId = new mongoose.Types.ObjectId().toString();
    const transferId = new mongoose.Types.ObjectId().toString();
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'OPTIONS',
        pathValue: `/pet/transfer/${petId}/${transferId}`,
        resource: '/pet/transfer/{petId}/{transferId}',
        headers: { origin: 'https://app.example.test' },
        pathParameters: { petId, transferId },
      }),
      createContext()
    );

    expect(result.statusCode).toBe(204);
    expect(result.body).toBe('');
    expect(result.headers['Access-Control-Allow-Origin']).toBe('*');
  });

  test('returns 204 for CORS OPTIONS preflight on /{petId}/ngo-reassignment', async () => {
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'OPTIONS',
        pathValue: `/pet/transfer/${petId}/ngo-reassignment`,
        resource: '/pet/transfer/{petId}/ngo-reassignment',
        headers: { origin: 'https://app.example.test' },
        pathParameters: { petId },
      }),
      createContext()
    );

    expect(result.statusCode).toBe(204);
    expect(result.body).toBe('');
    expect(result.headers['Access-Control-Allow-Origin']).toBe('*');
  });

  test('normalises DB infrastructure failures to 500', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId: userId,
      connectError: new Error('mongo down'),
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        pathValue: `/pet/transfer/${petId}`,
        resource: '/pet/transfer/{petId}',
        pathParameters: { petId },
        body: JSON.stringify({ regPlace: 'Hong Kong' }),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(500);
    expect(parsed.body.errorKey).toBe('common.internalError');
  });
});

// ===========================================================================
// POST /pet/transfer/{petId} — createTransfer
// ===========================================================================

describe('POST /pet/transfer/{petId} — createTransfer', () => {
  test('happy path: creates transfer record and returns 201', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();

    const { handler, authorizer, petModel } = loadHandlerWithMocks({
      authUserId: userId,
      petFindOneResults: [
        createLeanResult({ _id: petId, userId, ngoId: null, deleted: false }),
      ],
      petUpdateOneResult: { matchedCount: 1 },
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        pathValue: `/pet/transfer/${petId}`,
        resource: '/pet/transfer/{petId}',
        pathParameters: { petId },
        body: JSON.stringify({
          regDate: '2024-01-15',
          regPlace: 'Hong Kong',
          transferOwner: 'Alice',
          transferContact: '+85291234567',
          transferRemark: 'Rehomed',
        }),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(201);
    expect(parsed.body.petId).toBe(petId);
    expect(parsed.body.transferId).toBeDefined();
    expect(parsed.body.form.regPlace).toBe('Hong Kong');
    expect(petModel.updateOne).toHaveBeenCalledWith(
      { _id: petId, deleted: false },
      { $push: { transfer: expect.objectContaining({ regPlace: 'Hong Kong' }) } }
    );
  });

  test('returns 400 when body is empty object (requireNonEmpty is true by default)', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();

    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId: userId,
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        pathValue: `/pet/transfer/${petId}`,
        resource: '/pet/transfer/{petId}',
        pathParameters: { petId },
        body: JSON.stringify({}),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
  });

  test('happy path: NGO-owned pet allows create when ngoId matches', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const ngoId = 'ngo-hk-001';
    const petId = new mongoose.Types.ObjectId().toString();

    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId: userId,
      authRole: 'ngo',
      authNgoId: ngoId,
      petFindOneResults: [
        createLeanResult({ _id: petId, userId: null, ngoId, deleted: false }),
      ],
      petUpdateOneResult: { matchedCount: 1 },
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        pathValue: `/pet/transfer/${petId}`,
        resource: '/pet/transfer/{petId}',
        pathParameters: { petId },
        body: JSON.stringify({ regPlace: 'Kowloon' }),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(201);
  });

  test('returns 400 for invalid petId format', async () => {
    const { handler, authorizer } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'POST',
        pathValue: '/pet/transfer/not-an-objectid',
        resource: '/pet/transfer/{petId}',
        pathParameters: { petId: 'not-an-objectid' },
        body: JSON.stringify({ regPlace: 'Hong Kong' }),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('petTransfer.errors.invalidPetId');
  });

  test('returns 400 for invalid date format', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();

    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId: userId,
      petFindOneResults: [
        createLeanResult({ _id: petId, userId, ngoId: null, deleted: false }),
      ],
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        pathValue: `/pet/transfer/${petId}`,
        resource: '/pet/transfer/{petId}',
        pathParameters: { petId },
        body: JSON.stringify({ regDate: 'not-a-date' }),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('petTransfer.errors.transfer.invalidDateFormat');
  });

  test('returns 403 when caller does not own the pet', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const otherUserId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();

    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId: userId,
      petFindOneResults: [
        createLeanResult({ _id: petId, userId: otherUserId, ngoId: null, deleted: false }),
      ],
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        pathValue: `/pet/transfer/${petId}`,
        resource: '/pet/transfer/{petId}',
        pathParameters: { petId },
        body: JSON.stringify({ regPlace: 'Hong Kong' }),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(403);
    expect(parsed.body.errorKey).toBe('common.forbidden');
  });

  test('returns 404 when pet does not exist', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();

    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId: userId,
      petFindOneResults: [createLeanResult(null)],
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        pathValue: `/pet/transfer/${petId}`,
        resource: '/pet/transfer/{petId}',
        pathParameters: { petId },
        body: JSON.stringify({ regPlace: 'Hong Kong' }),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(404);
    expect(parsed.body.errorKey).toBe('petTransfer.errors.petNotFound');
  });

  test('returns 400 for malformed JSON body', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler, authorizer } = loadHandlerWithMocks({ authUserId: userId });

    const result = await handler(
      createEvent({
        method: 'POST',
        pathValue: `/pet/transfer/${petId}`,
        resource: '/pet/transfer/{petId}',
        pathParameters: { petId },
        body: '{ invalid json',
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
  });
});

// ===========================================================================
// PATCH /pet/transfer/{petId}/{transferId} — updateTransfer
// ===========================================================================

describe('PATCH /pet/transfer/{petId}/{transferId} — updateTransfer', () => {
  test('happy path: updates transfer record and returns 200', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const transferId = new mongoose.Types.ObjectId().toString();

    const { handler, authorizer, petModel } = loadHandlerWithMocks({
      authUserId: userId,
      petFindOneResults: [
        // ownership check
        createLeanResult({ _id: petId, userId, ngoId: null, deleted: false }),
        // sub-doc existence check
        createLeanResult({ _id: petId }),
      ],
      petUpdateOneResult: { matchedCount: 1 },
    });

    const result = await handler(
      createEvent({
        method: 'PATCH',
        pathValue: `/pet/transfer/${petId}/${transferId}`,
        resource: '/pet/transfer/{petId}/{transferId}',
        pathParameters: { petId, transferId },
        body: JSON.stringify({ regPlace: 'Tsuen Wan', transferRemark: 'Updated' }),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(200);
    expect(parsed.body.petId).toBe(petId);
    expect(parsed.body.transferId).toBe(transferId);
    expect(petModel.updateOne).toHaveBeenCalledWith(
      { _id: petId, deleted: false, 'transfer._id': transferId },
      { $set: expect.objectContaining({ 'transfer.$.regPlace': 'Tsuen Wan' }) }
    );
  });

  test('returns 400 when body is empty (no fields to update)', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const transferId = new mongoose.Types.ObjectId().toString();

    const { handler, authorizer } = loadHandlerWithMocks({ authUserId: userId });

    const result = await handler(
      createEvent({
        method: 'PATCH',
        pathValue: `/pet/transfer/${petId}/${transferId}`,
        resource: '/pet/transfer/{petId}/{transferId}',
        pathParameters: { petId, transferId },
        body: JSON.stringify({}),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
  });

  test('returns 400 for invalid transferId format', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();

    const { handler, authorizer } = loadHandlerWithMocks({ authUserId: userId });

    const result = await handler(
      createEvent({
        method: 'PATCH',
        pathValue: `/pet/transfer/${petId}/bad-id`,
        resource: '/pet/transfer/{petId}/{transferId}',
        pathParameters: { petId, transferId: 'bad-id' },
        body: JSON.stringify({ regPlace: 'Somewhere' }),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('petTransfer.errors.transfer.invalidTransferId');
  });

  test('returns 404 when transfer sub-document does not exist on pet', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const transferId = new mongoose.Types.ObjectId().toString();

    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId: userId,
      petFindOneResults: [
        // ownership check passes
        createLeanResult({ _id: petId, userId, ngoId: null, deleted: false }),
        // sub-doc check returns null (record not found on this pet)
        createLeanResult(null),
      ],
    });

    const result = await handler(
      createEvent({
        method: 'PATCH',
        pathValue: `/pet/transfer/${petId}/${transferId}`,
        resource: '/pet/transfer/{petId}/{transferId}',
        pathParameters: { petId, transferId },
        body: JSON.stringify({ regPlace: 'Somewhere' }),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(404);
    expect(parsed.body.errorKey).toBe('petTransfer.errors.transfer.notFound');
  });

  test('returns 400 for invalid date format on update', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const transferId = new mongoose.Types.ObjectId().toString();

    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId: userId,
      petFindOneResults: [
        createLeanResult({ _id: petId, userId, ngoId: null, deleted: false }),
        createLeanResult({ _id: petId }),
      ],
    });

    const result = await handler(
      createEvent({
        method: 'PATCH',
        pathValue: `/pet/transfer/${petId}/${transferId}`,
        resource: '/pet/transfer/{petId}/{transferId}',
        pathParameters: { petId, transferId },
        body: JSON.stringify({ regDate: 'not-a-date' }),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('petTransfer.errors.transfer.invalidDateFormat');
  });

  test('returns 403 when caller does not own the pet', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const otherUserId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const transferId = new mongoose.Types.ObjectId().toString();

    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId: userId,
      petFindOneResults: [
        createLeanResult({ _id: petId, userId: otherUserId, ngoId: null, deleted: false }),
      ],
    });

    const result = await handler(
      createEvent({
        method: 'PATCH',
        pathValue: `/pet/transfer/${petId}/${transferId}`,
        resource: '/pet/transfer/{petId}/{transferId}',
        pathParameters: { petId, transferId },
        body: JSON.stringify({ regPlace: 'Somewhere' }),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(403);
    expect(parsed.body.errorKey).toBe('common.forbidden');
  });
});

// ===========================================================================
// DELETE /pet/transfer/{petId}/{transferId} — deleteTransfer
// ===========================================================================

describe('DELETE /pet/transfer/{petId}/{transferId} — deleteTransfer', () => {
  test('happy path: deletes transfer record and returns 200', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const transferId = new mongoose.Types.ObjectId().toString();

    const { handler, authorizer, petModel } = loadHandlerWithMocks({
      authUserId: userId,
      petFindOneResults: [
        createLeanResult({ _id: petId, userId, ngoId: null, deleted: false }),
      ],
      petUpdateOneResult: { matchedCount: 1 },
    });

    const result = await handler(
      createEvent({
        method: 'DELETE',
        pathValue: `/pet/transfer/${petId}/${transferId}`,
        resource: '/pet/transfer/{petId}/{transferId}',
        pathParameters: { petId, transferId },
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(200);
    expect(parsed.body.petId).toBe(petId);
    expect(parsed.body.transferId).toBe(transferId);
    expect(petModel.updateOne).toHaveBeenCalledWith(
      { _id: petId, deleted: false, 'transfer._id': transferId },
      { $pull: { transfer: { _id: transferId } } }
    );
  });

  test('returns 404 when transfer record is not found on the pet', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const transferId = new mongoose.Types.ObjectId().toString();

    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId: userId,
      petFindOneResults: [
        createLeanResult({ _id: petId, userId, ngoId: null, deleted: false }),
      ],
      petUpdateOneResult: { matchedCount: 0 },
    });

    const result = await handler(
      createEvent({
        method: 'DELETE',
        pathValue: `/pet/transfer/${petId}/${transferId}`,
        resource: '/pet/transfer/{petId}/{transferId}',
        pathParameters: { petId, transferId },
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(404);
    expect(parsed.body.errorKey).toBe('petTransfer.errors.transfer.notFound');
  });

  test('returns 400 for invalid transferId format', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();

    const { handler, authorizer } = loadHandlerWithMocks({ authUserId: userId });

    const result = await handler(
      createEvent({
        method: 'DELETE',
        pathValue: `/pet/transfer/${petId}/bad-id`,
        resource: '/pet/transfer/{petId}/{transferId}',
        pathParameters: { petId, transferId: 'bad-id' },
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('petTransfer.errors.transfer.invalidTransferId');
  });

  test('returns 403 when caller does not own the pet', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const otherUserId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const transferId = new mongoose.Types.ObjectId().toString();

    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId: userId,
      petFindOneResults: [
        createLeanResult({ _id: petId, userId: otherUserId, ngoId: null, deleted: false }),
      ],
    });

    const result = await handler(
      createEvent({
        method: 'DELETE',
        pathValue: `/pet/transfer/${petId}/${transferId}`,
        resource: '/pet/transfer/{petId}/{transferId}',
        pathParameters: { petId, transferId },
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(403);
    expect(parsed.body.errorKey).toBe('common.forbidden');
  });
});

// ===========================================================================
// POST /pet/transfer/{petId}/ngo-reassignment — ngoTransfer
// ===========================================================================

describe('POST /pet/transfer/{petId}/ngo-reassignment — ngoTransfer', () => {
  const VALID_NGO_BODY = {
    UserEmail: 'adopter@example.com',
    UserContact: '+85291234567',
    regDate: '2024-03-01',
    regPlace: 'Mong Kok',
    transferOwner: 'Bob',
    isTransferred: true,
  };

  function buildNGOSetup({ userId, ngoId, petId, targetUserId, overridePetDoc } = {}) {
    const resolvedPetId = petId || new mongoose.Types.ObjectId().toString();
    const resolvedNgoId = ngoId || 'ngo-hk-001';
    const resolvedTargetUserId = targetUserId || new mongoose.Types.ObjectId().toString();
    const resolvedUserId = userId || new mongoose.Types.ObjectId().toString();

    return {
      userId: resolvedUserId,
      ngoId: resolvedNgoId,
      petId: resolvedPetId,
      targetUserId: resolvedTargetUserId,
      petDoc: overridePetDoc || {
        _id: resolvedPetId,
        userId: null,
        ngoId: resolvedNgoId,
        deleted: false,
      },
      userDoc: { _id: resolvedTargetUserId },
    };
  }

  test('happy path: NGO reassigns pet ownership to validated user', async () => {
    const { userId, ngoId, petId, targetUserId, petDoc, userDoc } = buildNGOSetup();

    const { handler, authorizer, petModel } = loadHandlerWithMocks({
      authUserId: userId,
      authRole: 'ngo',
      authNgoId: ngoId,
      petFindOneResults: [createLeanResult(petDoc)],
      userFindOneResults: [createLeanResult(userDoc), createLeanResult(userDoc)],
      petUpdateOneResult: { matchedCount: 1 },
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        pathValue: `/pet/transfer/${petId}/ngo-reassignment`,
        resource: '/pet/transfer/{petId}/ngo-reassignment',
        pathParameters: { petId },
        body: JSON.stringify(VALID_NGO_BODY),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(200);
    expect(parsed.body.petId).toBe(petId);
    expect(petModel.updateOne).toHaveBeenCalledWith(
      { _id: petId, deleted: false },
      {
        $set: expect.objectContaining({
          userId: userDoc._id,
          ngoId: '',
        }),
      }
    );
  });

  test('returns 403 when caller does not have NGO role', async () => {
    const { userId, petId } = buildNGOSetup();

    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId: userId,
      authRole: 'user', // not ngo
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        pathValue: `/pet/transfer/${petId}/ngo-reassignment`,
        resource: '/pet/transfer/{petId}/ngo-reassignment',
        pathParameters: { petId },
        body: JSON.stringify(VALID_NGO_BODY),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(403);
    expect(parsed.body.errorKey).toBe('common.forbidden');
  });

  test('returns 400 when neither UserEmail nor UserContact is provided', async () => {
    const { userId, ngoId, petId } = buildNGOSetup();

    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId: userId,
      authRole: 'ngo',
      authNgoId: ngoId,
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        pathValue: `/pet/transfer/${petId}/ngo-reassignment`,
        resource: '/pet/transfer/{petId}/ngo-reassignment',
        pathParameters: { petId },
        body: JSON.stringify({ regPlace: 'Hong Kong' }), // non-empty body but no identifier
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('petTransfer.errors.ngoTransfer.missingRequiredFields');
  });

  test('happy path: email-only lookup succeeds when UserContact is absent', async () => {
    const { userId, ngoId, petId, targetUserId, petDoc } = buildNGOSetup();
    const userDoc = { _id: targetUserId };

    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId: userId,
      authRole: 'ngo',
      authNgoId: ngoId,
      petFindOneResults: [createLeanResult(petDoc)],
      userFindOneResults: [createLeanResult(userDoc)],
      petUpdateOneResult: { matchedCount: 1 },
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        pathValue: `/pet/transfer/${petId}/ngo-reassignment`,
        resource: '/pet/transfer/{petId}/ngo-reassignment',
        pathParameters: { petId },
        body: JSON.stringify({ UserEmail: 'adopter@example.com' }),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(200);
    expect(parsed.body.petId).toBe(petId);
  });

  test('happy path: phone-only lookup succeeds when UserEmail is absent', async () => {
    const { userId, ngoId, petId, targetUserId, petDoc } = buildNGOSetup();
    const userDoc = { _id: targetUserId };

    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId: userId,
      authRole: 'ngo',
      authNgoId: ngoId,
      petFindOneResults: [createLeanResult(petDoc)],
      userFindOneResults: [createLeanResult(userDoc)],
      petUpdateOneResult: { matchedCount: 1 },
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        pathValue: `/pet/transfer/${petId}/ngo-reassignment`,
        resource: '/pet/transfer/{petId}/ngo-reassignment',
        pathParameters: { petId },
        body: JSON.stringify({ UserContact: '+85291234567' }),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(200);
    expect(parsed.body.petId).toBe(petId);
  });

  test('returns 400 for invalid email format', async () => {
    const { userId, ngoId, petId, petDoc } = buildNGOSetup();

    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId: userId,
      authRole: 'ngo',
      authNgoId: ngoId,
      petFindOneResults: [createLeanResult(petDoc)],
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        pathValue: `/pet/transfer/${petId}/ngo-reassignment`,
        resource: '/pet/transfer/{petId}/ngo-reassignment',
        pathParameters: { petId },
        body: JSON.stringify({ UserEmail: 'not-an-email', UserContact: '+85291234567' }),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('petTransfer.errors.ngoTransfer.invalidEmailFormat');
  });

  test('returns 400 for invalid phone format', async () => {
    const { userId, ngoId, petId, petDoc } = buildNGOSetup();

    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId: userId,
      authRole: 'ngo',
      authNgoId: ngoId,
      petFindOneResults: [createLeanResult(petDoc)],
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        pathValue: `/pet/transfer/${petId}/ngo-reassignment`,
        resource: '/pet/transfer/{petId}/ngo-reassignment',
        pathParameters: { petId },
        body: JSON.stringify({ UserEmail: 'user@example.com', UserContact: '91234567' }), // no + prefix
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('petTransfer.errors.ngoTransfer.invalidPhoneFormat');
  });

  test('returns 400 for invalid date format on NGO transfer', async () => {
    const { userId, ngoId, petId, petDoc } = buildNGOSetup();

    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId: userId,
      authRole: 'ngo',
      authNgoId: ngoId,
      petFindOneResults: [createLeanResult(petDoc)],
      userFindOneResults: [
        createLeanResult({ _id: new mongoose.Types.ObjectId().toString() }),
        createLeanResult({ _id: new mongoose.Types.ObjectId().toString() }),
      ],
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        pathValue: `/pet/transfer/${petId}/ngo-reassignment`,
        resource: '/pet/transfer/{petId}/ngo-reassignment',
        pathParameters: { petId },
        body: JSON.stringify({
          UserEmail: 'user@example.com',
          UserContact: '+85291234567',
          regDate: 'not-a-date',
        }),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('petTransfer.errors.ngoTransfer.invalidDateFormat');
  });

  test('returns 404 when target user is not found by email', async () => {
    const { userId, ngoId, petId, petDoc } = buildNGOSetup();

    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId: userId,
      authRole: 'ngo',
      authNgoId: ngoId,
      petFindOneResults: [createLeanResult(petDoc)],
      userFindOneResults: [
        createLeanResult(null), // user not found by email
        createLeanResult({ _id: new mongoose.Types.ObjectId().toString() }),
      ],
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        pathValue: `/pet/transfer/${petId}/ngo-reassignment`,
        resource: '/pet/transfer/{petId}/ngo-reassignment',
        pathParameters: { petId },
        body: JSON.stringify({ UserEmail: 'ghost@example.com', UserContact: '+85291234567' }),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(404);
    expect(parsed.body.errorKey).toBe('petTransfer.errors.ngoTransfer.targetUserNotFound');
  });

  test('returns 400 when email and phone resolve to different users', async () => {
    const { userId, ngoId, petId, petDoc } = buildNGOSetup();
    const user1Id = new mongoose.Types.ObjectId().toString();
    const user2Id = new mongoose.Types.ObjectId().toString();

    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId: userId,
      authRole: 'ngo',
      authNgoId: ngoId,
      petFindOneResults: [createLeanResult(petDoc)],
      userFindOneResults: [
        createLeanResult({ _id: user1Id }), // found by email
        createLeanResult({ _id: user2Id }), // found by phone — different user
      ],
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        pathValue: `/pet/transfer/${petId}/ngo-reassignment`,
        resource: '/pet/transfer/{petId}/ngo-reassignment',
        pathParameters: { petId },
        body: JSON.stringify({
          UserEmail: 'user@example.com',
          UserContact: '+85291234567',
        }),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('petTransfer.errors.ngoTransfer.userIdentityMismatch');
  });

  test('returns 403 when NGO caller does not own the pet', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const ngoId = 'ngo-hk-001';
    const petId = new mongoose.Types.ObjectId().toString();

    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId: userId,
      authRole: 'ngo',
      authNgoId: ngoId,
      petFindOneResults: [
        // Pet belongs to a different NGO
        createLeanResult({ _id: petId, userId: null, ngoId: 'ngo-different', deleted: false }),
      ],
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        pathValue: `/pet/transfer/${petId}/ngo-reassignment`,
        resource: '/pet/transfer/{petId}/ngo-reassignment',
        pathParameters: { petId },
        body: JSON.stringify(VALID_NGO_BODY),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(403);
    expect(parsed.body.errorKey).toBe('common.forbidden');
  });

  test('returns 400 for empty body on NGO transfer', async () => {
    const { userId, ngoId, petId } = buildNGOSetup();

    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId: userId,
      authRole: 'ngo',
      authNgoId: ngoId,
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        pathValue: `/pet/transfer/${petId}/ngo-reassignment`,
        resource: '/pet/transfer/{petId}/ngo-reassignment',
        pathParameters: { petId },
        body: JSON.stringify({}),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
  });

  test('Tier 4 — DB write: updateOne sets all transferNGO fields and reassigns ownership', async () => {
    const { userId, ngoId, petId, targetUserId, petDoc } = buildNGOSetup();
    const userDoc = { _id: targetUserId };
    const fullBody = {
      UserEmail: 'adopter@example.com',
      UserContact: '+85291234567',
      regDate: '2024-03-01',
      regPlace: 'Mong Kok',
      transferOwner: 'Bob',
      transferRemark: 'Rehomed via NGO',
      isTransferred: true,
    };

    const { handler, authorizer, petModel } = loadHandlerWithMocks({
      authUserId: userId,
      authRole: 'ngo',
      authNgoId: ngoId,
      petFindOneResults: [createLeanResult(petDoc)],
      userFindOneResults: [createLeanResult(userDoc), createLeanResult(userDoc)],
      petUpdateOneResult: { matchedCount: 1 },
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        pathValue: `/pet/transfer/${petId}/ngo-reassignment`,
        resource: '/pet/transfer/{petId}/ngo-reassignment',
        pathParameters: { petId },
        body: JSON.stringify(fullBody),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(200);
    expect(parsed.body.petId).toBe(petId);

    // Verify DB write: ownership transferred to target user, NGO cleared
    expect(petModel.updateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = petModel.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: petId, deleted: false });
    expect(update.$set.userId).toEqual(userDoc._id);
    expect(update.$set.ngoId).toBe('');

    // transferNGO sub-document fields written
    expect(update.$set['transferNGO.0.UserEmail']).toBe('adopter@example.com');
    expect(update.$set['transferNGO.0.UserContact']).toBe('+85291234567');
    expect(update.$set['transferNGO.0.regPlace']).toBe('Mong Kok');
    expect(update.$set['transferNGO.0.transferOwner']).toBe('Bob');
    expect(update.$set['transferNGO.0.transferRemark']).toBe('Rehomed via NGO');
    expect(update.$set['transferNGO.0.isTransferred']).toBe(true);
    // regDate stored as a Date object (parsed from YYYY-MM-DD)
    expect(update.$set['transferNGO.0.regDate']).toBeInstanceOf(Date);
  });
});

// ===========================================================================
// Cyberattack / abuse cases
// ===========================================================================

describe('pet-transfer handler — cyberattack / abuse cases', () => {
  test('rejects path traversal attempt in petId position', async () => {
    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId: new mongoose.Types.ObjectId().toString(),
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        pathValue: '/pet/transfer/../admin',
        resource: '/pet/transfer/{petId}',
        pathParameters: { petId: '../admin' },
        body: JSON.stringify({ regPlace: 'Attack' }),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    // ../admin is not a valid ObjectId
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('petTransfer.errors.invalidPetId');
  });

  test('rejects SQL/NoSQL injection strings in petId position', async () => {
    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId: new mongoose.Types.ObjectId().toString(),
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        pathValue: "/pet/transfer/$where:function(){return true}",
        resource: '/pet/transfer/{petId}',
        pathParameters: { petId: "$where:function(){return true}" },
        body: JSON.stringify({ regPlace: 'Injection' }),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.body.errorKey).toBe('petTransfer.errors.invalidPetId');
  });

  test('rejects oversized email in NGO transfer body', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const ngoId = 'ngo-hk-001';
    const petId = new mongoose.Types.ObjectId().toString();

    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId: userId,
      authRole: 'ngo',
      authNgoId: ngoId,
      petFindOneResults: [
        createLeanResult({ _id: petId, userId: null, ngoId, deleted: false }),
      ],
    });

    const oversizedEmail = 'a'.repeat(500) + '@example.com';

    const result = await handler(
      createEvent({
        method: 'POST',
        pathValue: `/pet/transfer/${petId}/ngo-reassignment`,
        resource: '/pet/transfer/{petId}/ngo-reassignment',
        pathParameters: { petId },
        body: JSON.stringify({ UserEmail: oversizedEmail, UserContact: '+85291234567' }),
        authorizer,
      }),
      createContext()
    );

    // Invalid email format due to whitespace/length not matching regex
    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(400);
    expect([
      'petTransfer.errors.ngoTransfer.invalidEmailFormat',
      'petTransfer.errors.ngoTransfer.targetUserNotFound',
    ]).toContain(parsed.body.errorKey);
  });

  test('unauthenticated NGO transfer attempt returns 401, not 403', async () => {
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'POST',
        pathValue: `/pet/transfer/${petId}/ngo-reassignment`,
        resource: '/pet/transfer/{petId}/ngo-reassignment',
        pathParameters: { petId },
        body: JSON.stringify({
          UserEmail: 'attacker@example.com',
          UserContact: '+85291234567',
        }),
        // no authorizer
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    // auth check runs before role check
    expect(parsed.statusCode).toBe(401);
    expect(parsed.body.errorKey).toBe('common.unauthorized');
  });

  test('user-role caller cannot perform NGO transfer on own-userId pet', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();

    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId: userId,
      authRole: 'user',
      petFindOneResults: [
        createLeanResult({ _id: petId, userId, ngoId: null, deleted: false }),
      ],
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        pathValue: `/pet/transfer/${petId}/ngo-reassignment`,
        resource: '/pet/transfer/{petId}/ngo-reassignment',
        pathParameters: { petId },
        body: JSON.stringify({ UserEmail: 'user@example.com', UserContact: '+85291234567' }),
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    // Role check runs before ownership check
    expect(parsed.statusCode).toBe(403);
    expect(parsed.body.errorKey).toBe('common.forbidden');
  });
});
