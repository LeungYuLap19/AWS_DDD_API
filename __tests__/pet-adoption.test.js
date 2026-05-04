/**
 * Tier 2 integration tests — pet-adoption handler
 *
 * Routes under test (explicit, no proxy):
 *   GET    /pet/adoption         → browse list (public)
 *   GET    /pet/adoption/{id}    → browse detail (no auth) OR managed GET (with auth)
 *   POST   /pet/adoption/{id}    → managed create (protected)
 *   PATCH  /pet/adoption/{id}    → managed update (protected)
 *   DELETE /pet/adoption/{id}    → managed delete (protected)
 *
 * Run:  npx jest pet-adoption
 */

const path = require('path');
const mongoose = require('mongoose');

const handlerModulePath = path.resolve(__dirname, '../dist/functions/pet-adoption/index.js');
const sharedRuntimeModulePath = path.resolve(
  __dirname,
  '../dist/layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/index.js'
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createContext() {
  return {
    awsRequestId: 'req-pet-adoption-test',
    callbackWaitsForEmptyEventLoop: true,
  };
}

function createAuthorizer({ userId = new mongoose.Types.ObjectId().toString(), role = 'user', ngoId } = {}) {
  const auth = { userId, principalId: userId, userRole: role };
  if (ngoId !== undefined) auth.ngoId = ngoId;
  return auth;
}

function createEvent({
  method = 'GET',
  path: routePath = '/pet/adoption',
  resource = '/pet/adoption',
  body = null,
  authorizer,
  queryStringParameters = null,
  pathParameters = null,
} = {}) {
  return {
    httpMethod: method,
    path: routePath,
    resource,
    headers: {},
    body,
    pathParameters,
    queryStringParameters,
    multiValueQueryStringParameters: null,
    multiValueHeaders: {},
    stageVariables: null,
    requestContext: {
      requestId: 'req-pet-adoption-test',
      authorizer: authorizer || undefined,
      identity: { sourceIp: '198.51.100.10' },
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
  };
}

function makeBrowseDoc(overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId().toString(),
    Name: 'Doggo',
    Age: 12,
    Sex: 'M',
    Breed: 'Mixed',
    Animal_Type: 'Dog',
    Remark: 'Friendly',
    Image_URL: ['https://example.com/img.jpg'],
    URL: 'https://example.com',
    AdoptionSite: 'SPCA',
    Creation_Date: new Date('2024-01-01'),
    ...overrides,
  };
}

function makePetDoc(userId, ngoId) {
  const doc = { _id: new mongoose.Types.ObjectId().toString(), userId, deleted: false };
  if (ngoId !== undefined) doc.ngoId = ngoId;
  return doc;
}

function makeAdoptionDoc(petId, overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId().toString(),
    petId,
    postAdoptionName: 'Buddy',
    isNeutered: true,
    createdAt: new Date('2024-06-01'),
    updatedAt: new Date('2024-06-01'),
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
  process.env.ADOPTION_MONGODB_URI = 'mongodb://example.test/adoption_uat';
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
  browseList = [],
  browseCount = 0,
  browseDetail = null,
  petDoc = null,
  adoptionDoc = null,
  createResult = {},
  updateResult = { matchedCount: 1, modifiedCount: 1 },
  deleteResult = { deletedCount: 1 },
  connectError = null,
  createError = null,
} = {}) {
  jest.resetModules();
  jest.clearAllMocks();
  resetEnv(envOverrides);

  const actualMongoose = jest.requireActual('mongoose');

  const adoptionBrowseModel = {
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(browseList),
    }),
    findOne: jest.fn().mockReturnValue(createLeanResult(browseDetail)),
    countDocuments: jest.fn().mockResolvedValue(browseCount),
    aggregate: jest.fn().mockResolvedValue(browseList),
  };

  const petModel = {
    findOne: jest.fn().mockReturnValue(createLeanResult(petDoc)),
  };

  const petAdoptionModel = {
    findOne: jest.fn().mockReturnValue(createLeanResult(adoptionDoc)),
    create: createError
      ? jest.fn().mockRejectedValue(createError)
      : jest.fn().mockResolvedValue(createResult),
    updateOne: jest.fn().mockResolvedValue(updateResult),
    deleteOne: jest.fn().mockResolvedValue(deleteResult),
  };

  function makeConnection(modelFactory) {
    const conn = {
      readyState: 1,
      models: {},
      model: jest.fn((name) => modelFactory(name)),
    };
    conn.asPromise = connectError
      ? jest.fn().mockRejectedValue(connectError)
      : jest.fn().mockResolvedValue(conn);
    return conn;
  }

  const browseConn = makeConnection((name) => {
    if (name === 'Adoption') return adoptionBrowseModel;
    throw new Error(`Unexpected browse model: ${name}`);
  });

  const mainConn = makeConnection((name) => {
    if (name === 'Pet') return petModel;
    if (name === 'pet_adoptions') return petAdoptionModel;
    throw new Error(`Unexpected main model: ${name}`);
  });

  const mongooseMock = {
    Schema: actualMongoose.Schema,
    Types: actualMongoose.Types,
    isValidObjectId: actualMongoose.isValidObjectId,
    createConnection: jest.fn().mockImplementation((uri) =>
      uri.includes('adoption') ? browseConn : mainConn
    ),
    models: {},
  };

  jest.doMock('mongoose', () => ({ __esModule: true, default: mongooseMock }));
  jest.doMock('@aws-ddd-api/shared', () => require(sharedRuntimeModulePath), { virtual: true });

  const { handler } = require(handlerModulePath);
  const authorizer = createAuthorizer({ userId: authUserId, role: authRole, ngoId: authNgoId });
  return { handler, authorizer, petModel, petAdoptionModel, adoptionBrowseModel };
}

// ---------------------------------------------------------------------------
// Suppress console noise
// ---------------------------------------------------------------------------

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  jest.restoreAllMocks();
});

// ===========================================================================
// Tests
// ===========================================================================

describe('pet-adoption — GET /pet/adoption (browse list, public)', () => {
  test('returns adoption list with pagination', async () => {
    const docs = [makeBrowseDoc(), makeBrowseDoc()];
    const { handler } = loadHandlerWithMocks({ browseList: docs, browseCount: 2 });

    const result = await handler(
      createEvent({ method: 'GET', path: '/pet/adoption', resource: '/pet/adoption' }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(200);
  });

  test('returns 400 for invalid page param', async () => {
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'GET',
        path: '/pet/adoption',
        resource: '/pet/adoption',
        queryStringParameters: { page: 'notanumber' },
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(400);
  });

  test('returns 400 when search param is too long', async () => {
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'GET',
        path: '/pet/adoption',
        resource: '/pet/adoption',
        queryStringParameters: { search: 'a'.repeat(300) },
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(400);
  });
});

describe('pet-adoption — GET /pet/adoption/{id} (no auth → browse detail)', () => {
  test('returns 400 for invalid ObjectId', async () => {
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'GET',
        path: '/pet/adoption/not-an-id',
        resource: '/pet/adoption/{id}',
        pathParameters: { id: 'not-an-id' },
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(400);
  });

  test('returns 404 when not found in adoption_list', async () => {
    const id = new mongoose.Types.ObjectId().toString();
    const { handler } = loadHandlerWithMocks({ browseDetail: null });

    const result = await handler(
      createEvent({
        method: 'GET',
        path: `/pet/adoption/${id}`,
        resource: '/pet/adoption/{id}',
        pathParameters: { id },
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(404);
  });

  test('returns 200 with browse doc when found', async () => {
    const id = new mongoose.Types.ObjectId().toString();
    const { handler } = loadHandlerWithMocks({ browseDetail: makeBrowseDoc({ _id: id }) });

    const result = await handler(
      createEvent({
        method: 'GET',
        path: `/pet/adoption/${id}`,
        resource: '/pet/adoption/{id}',
        pathParameters: { id },
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(200);
  });
});

describe('pet-adoption — GET /pet/adoption/{id} (with auth → managed record GET)', () => {
  test('returns 400 for invalid petId', async () => {
    const { handler, authorizer } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'GET',
        path: '/pet/adoption/bad-id',
        resource: '/pet/adoption/{id}',
        pathParameters: { id: 'bad-id' },
        authorizer,
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(400);
  });

  test('returns 403 when caller does not own the pet', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const otherId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId: userId,
      petDoc: makePetDoc(new mongoose.Types.ObjectId(otherId)),
    });

    const result = await handler(
      createEvent({
        method: 'GET',
        path: `/pet/adoption/${petId}`,
        resource: '/pet/adoption/{id}',
        pathParameters: { id: petId },
        authorizer,
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(403);
  });

  test('returns form=null when no record exists', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId: userId,
      petDoc: makePetDoc(new mongoose.Types.ObjectId(userId)),
      adoptionDoc: null,
    });

    const result = await handler(
      createEvent({
        method: 'GET',
        path: `/pet/adoption/${petId}`,
        resource: '/pet/adoption/{id}',
        pathParameters: { id: petId },
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(200);
    expect(parsed.body.form).toBeNull();
  });

  test('returns 200 with form when record exists', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId: userId,
      petDoc: makePetDoc(new mongoose.Types.ObjectId(userId)),
      adoptionDoc: makeAdoptionDoc(petId),
    });

    const result = await handler(
      createEvent({
        method: 'GET',
        path: `/pet/adoption/${petId}`,
        resource: '/pet/adoption/{id}',
        pathParameters: { id: petId },
        authorizer,
      }),
      createContext()
    );

    const parsed = parseResponse(result);
    expect(parsed.statusCode).toBe(200);
    expect(parsed.body.form).not.toBeNull();
  });
});

describe('pet-adoption — POST /pet/adoption/{id} (managed create)', () => {
  test('returns 401 without auth', async () => {
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'POST',
        path: `/pet/adoption/${petId}`,
        resource: '/pet/adoption/{id}',
        pathParameters: { id: petId },
        body: JSON.stringify({ postAdoptionName: 'Buddy' }),
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(401);
  });

  test('returns 400 for invalid petId', async () => {
    const { handler, authorizer } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'POST',
        path: '/pet/adoption/bad-id',
        resource: '/pet/adoption/{id}',
        pathParameters: { id: 'bad-id' },
        body: JSON.stringify({ postAdoptionName: 'Buddy' }),
        authorizer,
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(400);
  });

  test('returns 409 when record already exists', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId: userId,
      petDoc: makePetDoc(new mongoose.Types.ObjectId(userId)),
      adoptionDoc: makeAdoptionDoc(petId),
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: `/pet/adoption/${petId}`,
        resource: '/pet/adoption/{id}',
        pathParameters: { id: petId },
        body: JSON.stringify({ postAdoptionName: 'Buddy' }),
        authorizer,
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(409);
  });

  test('returns 403 when caller does not own the pet', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const otherId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId: userId,
      petDoc: makePetDoc(new mongoose.Types.ObjectId(otherId)),
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: `/pet/adoption/${petId}`,
        resource: '/pet/adoption/{id}',
        pathParameters: { id: petId },
        body: JSON.stringify({ postAdoptionName: 'Buddy' }),
        authorizer,
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(403);
  });

  test('returns 409 on race-condition duplicate (code 11000)', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const duplicateError = Object.assign(new Error('duplicate key'), { code: 11000 });
    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId: userId,
      petDoc: makePetDoc(new mongoose.Types.ObjectId(userId)),
      adoptionDoc: null,
      createError: duplicateError,
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: `/pet/adoption/${petId}`,
        resource: '/pet/adoption/{id}',
        pathParameters: { id: petId },
        body: JSON.stringify({ postAdoptionName: 'Buddy', isNeutered: true }),
        authorizer,
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(409);
  });

  test('returns 201 on successful create', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId: userId,
      petDoc: makePetDoc(new mongoose.Types.ObjectId(userId)),
      adoptionDoc: null,
      createResult: makeAdoptionDoc(petId),
    });

    const result = await handler(
      createEvent({
        method: 'POST',
        path: `/pet/adoption/${petId}`,
        resource: '/pet/adoption/{id}',
        pathParameters: { id: petId },
        body: JSON.stringify({ postAdoptionName: 'Buddy', isNeutered: true }),
        authorizer,
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(201);
  });
});

describe('pet-adoption — PATCH /pet/adoption/{id} (managed update)', () => {
  test('returns 401 without auth', async () => {
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'PATCH',
        path: `/pet/adoption/${petId}`,
        resource: '/pet/adoption/{id}',
        pathParameters: { id: petId },
        body: JSON.stringify({ postAdoptionName: 'Max' }),
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(401);
  });

  test('returns 403 when caller does not own the pet', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const otherId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId: userId,
      petDoc: makePetDoc(new mongoose.Types.ObjectId(otherId)),
    });

    const result = await handler(
      createEvent({
        method: 'PATCH',
        path: `/pet/adoption/${petId}`,
        resource: '/pet/adoption/{id}',
        pathParameters: { id: petId },
        body: JSON.stringify({ postAdoptionName: 'Max' }),
        authorizer,
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(403);
  });

  test('returns 400 on empty update body', async () => {
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'PATCH',
        path: `/pet/adoption/${petId}`,
        resource: '/pet/adoption/{id}',
        pathParameters: { id: petId },
        body: JSON.stringify({}),
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(400);
  });

  test('returns 404 when no record exists for petId', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId: userId,
      petDoc: makePetDoc(new mongoose.Types.ObjectId(userId)),
      updateResult: { matchedCount: 0, modifiedCount: 0 },
    });

    const result = await handler(
      createEvent({
        method: 'PATCH',
        path: `/pet/adoption/${petId}`,
        resource: '/pet/adoption/{id}',
        pathParameters: { id: petId },
        body: JSON.stringify({ postAdoptionName: 'Max' }),
        authorizer,
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(404);
  });

  test('returns 200 on successful update', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId: userId,
      petDoc: makePetDoc(new mongoose.Types.ObjectId(userId)),
    });

    const result = await handler(
      createEvent({
        method: 'PATCH',
        path: `/pet/adoption/${petId}`,
        resource: '/pet/adoption/{id}',
        pathParameters: { id: petId },
        body: JSON.stringify({ postAdoptionName: 'Max' }),
        authorizer,
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(200);
  });
});

describe('pet-adoption — DELETE /pet/adoption/{id} (managed delete)', () => {
  test('returns 401 without auth', async () => {
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'DELETE',
        path: `/pet/adoption/${petId}`,
        resource: '/pet/adoption/{id}',
        pathParameters: { id: petId },
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(401);
  });

  test('returns 403 when caller does not own the pet', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const otherId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId: userId,
      petDoc: makePetDoc(new mongoose.Types.ObjectId(otherId)),
    });

    const result = await handler(
      createEvent({
        method: 'DELETE',
        path: `/pet/adoption/${petId}`,
        resource: '/pet/adoption/{id}',
        pathParameters: { id: petId },
        authorizer,
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(403);
  });

  test('returns 404 when record does not exist', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId: userId,
      petDoc: makePetDoc(new mongoose.Types.ObjectId(userId)),
      deleteResult: { deletedCount: 0 },
    });

    const result = await handler(
      createEvent({
        method: 'DELETE',
        path: `/pet/adoption/${petId}`,
        resource: '/pet/adoption/{id}',
        pathParameters: { id: petId },
        authorizer,
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(404);
  });

  test('returns 200 on successful delete', async () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const petId = new mongoose.Types.ObjectId().toString();
    const { handler, authorizer } = loadHandlerWithMocks({
      authUserId: userId,
      petDoc: makePetDoc(new mongoose.Types.ObjectId(userId)),
    });

    const result = await handler(
      createEvent({
        method: 'DELETE',
        path: `/pet/adoption/${petId}`,
        resource: '/pet/adoption/{id}',
        pathParameters: { id: petId },
        authorizer,
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(200);
  });
});

describe('pet-adoption — infrastructure edge cases', () => {
  test('normalizes DB connection failure to 500', async () => {
    const { handler } = loadHandlerWithMocks({
      connectError: new Error('mongo down'),
    });

    const result = await handler(
      createEvent({ method: 'GET', path: '/pet/adoption', resource: '/pet/adoption' }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(500);
  });

  test('returns 404 for unknown route', async () => {
    const { handler } = loadHandlerWithMocks();

    const result = await handler(
      createEvent({
        method: 'GET',
        path: '/pet/adoption/some/extra/path',
        resource: '/pet/adoption/some/extra/path',
      }),
      createContext()
    );

    expect(parseResponse(result).statusCode).toBe(404);
  });
});

