const path = require('path');
const mongoose = require('mongoose');
const fs = require('fs');

const handlerModulePath = path.resolve(__dirname, '../dist/functions/pet-profile/index.js');
const sharedRuntimeModulePath = path.resolve(
  __dirname,
  '../dist/layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/index.js'
);
const templatePath = path.resolve(__dirname, '../template.yaml');

function createContext() {
  return {
    awsRequestId: 'req-tier2-pet-profile-handler',
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
  path = '/pet/profile/me',
  resource = '/pet/profile/me',
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
      requestId: 'req-tier2-pet-profile-handler',
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
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(value),
    exec: jest.fn().mockResolvedValue(value),
  };
}

function createFindChain(value) {
  return {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(value),
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
    headers: result.headers,
    body: result.body ? JSON.parse(result.body) : null,
  };
}

function buildCreatedPetDocument(overrides = {}) {
  const createdId = new mongoose.Types.ObjectId().toString();
  return {
    _id: createdId,
    toObject: () => ({
      _id: createdId,
      name: 'Mochi',
      animal: 'Dog',
      birthday: new Date('2024-01-01T00:00:00.000Z'),
      sex: 'Female',
      breedimage: [],
      ...overrides,
    }),
  };
}

function loadHandlerWithMocks({
  authUserId = new mongoose.Types.ObjectId().toString(),
  authRole,
  authNgoId,
  envOverrides = {},
  userDoc = null,
  petDoc = null,
  fallbackPetDoc = undefined,
  updatedPetDoc = null,
  petList = [],
  petCount = 0,
  publicTagPet = null,
  duplicateTag = null,
  duplicateNgoPet = null,
  deleteResult = { _id: new mongoose.Types.ObjectId().toString() },
  connectError = null,
  multipartForm = null,
  multipartError = null,
  petCreateValue = buildCreatedPetDocument(),
  petCreateError = null,
  petFindOneAndUpdateError = null,
  ngoCounterDoc = { ngoPrefix: 'NGO', seq: 1 },
  imageCollectionId = new mongoose.Types.ObjectId().toString(),
  rateLimitEntry = {
    count: 1,
    expireAt: new Date(Date.now() + 60_000),
    windowStart: new Date(),
  },
} = {}) {
  jest.resetModules();
  jest.clearAllMocks();
  resetEnv(envOverrides);

  const actualMongoose = jest.requireActual('mongoose');
  const resolvedAuthRole = authRole || (authNgoId ? 'ngo' : 'user');
  const petFindChain = createFindChain(petList);
  const multipartParseMock = multipartError
    ? jest.fn().mockRejectedValue(multipartError)
    : jest.fn().mockResolvedValue(multipartForm || { files: [] });
  const s3SendMock = jest.fn().mockResolvedValue({});

  const petFindOne = jest.fn((query = {}, projection) => {
    if (query.tagId && projection) {
      return createLeanResult(publicTagPet);
    }

    if (query.tagId && query.deleted && !projection) {
      return createLeanResult(duplicateTag);
    }

    if (query.ngoPetId) {
      return createLeanResult(duplicateNgoPet);
    }

    if (query._id && query.deleted === false) {
      return {
        lean: jest.fn().mockResolvedValue(petDoc),
        exec: jest.fn().mockResolvedValue(petDoc),
      };
    }

    if (query._id && query.deleted === undefined) {
      return createLeanResult(fallbackPetDoc === undefined ? petDoc : fallbackPetDoc);
    }

    return createLeanResult(null);
  });

  const petCreate = petCreateError
    ? jest.fn().mockRejectedValue(petCreateError)
    : jest.fn().mockResolvedValue(petCreateValue);

  const petFindOneAndUpdate = petFindOneAndUpdateError
    ? jest.fn().mockRejectedValue(petFindOneAndUpdateError)
    : jest.fn().mockResolvedValue(updatedPetDoc === undefined ? deleteResult : updatedPetDoc);

  const petFind = jest.fn(() => petFindChain);
  const petCountDocuments = jest.fn().mockResolvedValue(petCount);
  const userFindOne = jest.fn(() => createLeanResult(userDoc));
  const rateLimitModel = {
    findOneAndUpdate: jest.fn().mockResolvedValue(rateLimitEntry),
  };
  const ngoCountersModel = {
    findOneAndUpdate: jest.fn().mockResolvedValue(ngoCounterDoc),
  };
  const imageCollectionModel = {
    create: jest.fn().mockResolvedValue({ _id: imageCollectionId }),
    updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
  };

  const petModel = {
    findOne: petFindOne,
    create: petCreate,
    findOneAndUpdate: petFindOneAndUpdate,
    find: petFind,
    countDocuments: petCountDocuments,
  };

  const userModel = {
    findOne: userFindOne,
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
      if (name === 'User') return userModel;
      if (name === 'NgoCounters') return ngoCountersModel;
      if (name === 'ImageCollection') return imageCollectionModel;
      if (name === 'RateLimit' || name === 'MongoRateLimit') return rateLimitModel;

      throw new Error(`Unexpected model ${name}`);
    }),
  };

  jest.doMock('mongoose', () => ({
    __esModule: true,
    default: mongooseMock,
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
    default: {
      parse: multipartParseMock,
    },
  }));

  jest.doMock('@aws-ddd-api/shared', () => require(sharedRuntimeModulePath), { virtual: true });

  const { handler } = require(handlerModulePath);
  const authorizer = createAuthorizer({
    userId: authUserId,
    role: resolvedAuthRole,
    ngoId: resolvedAuthRole === 'ngo' ? authNgoId : undefined,
  });

  return {
    handler,
    authorizer,
    petModel,
    petFindChain,
    userModel,
    ngoCountersModel,
    imageCollectionModel,
    rateLimitModel,
    multipartParseMock,
    s3SendMock,
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

describe('pet-profile handler Tier 2 integration', () => {
  describe('Shared runtime and router proofs', () => {
    test('returns 404 for unknown route', async () => {
      const { handler } = loadHandlerWithMocks();

      const result = await handler(
        createEvent({
          method: 'GET',
          path: '/pet/profile/unknown/extra',
          resource: '/pet/profile/unknown/extra',
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
          path: '/pet/profile/me',
          resource: '/pet/profile/me',
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(405);
      expect(parsed.body.errorKey).toBe('common.methodNotAllowed');
    });

    test('returns 401 when protected route is missing authorizer context', async () => {
      const petId = new mongoose.Types.ObjectId().toString();
      const { handler } = loadHandlerWithMocks();

      const result = await handler(
        createEvent({
          method: 'GET',
          path: `/pet/profile/${petId}`,
          resource: '/pet/profile/{petId}',
          pathParameters: { petId },
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(401);
      expect(parsed.body.errorKey).toBe('common.unauthorized');
    });

    test('normalizes unexpected infrastructure errors to 500', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const { handler } = loadHandlerWithMocks({
        authUserId: userId,
        connectError: new Error('mongo down'),
      });

      const result = await handler(
        createEvent({
          method: 'GET',
          path: '/pet/profile/me',
          resource: '/pet/profile/me',
          authorizer: createAuthorizer({ userId }),
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(500);
      expect(parsed.body.errorKey).toBe('common.internalError');
    });

    test('handles allowed CORS preflight requests with 204', async () => {
      const { handler } = loadHandlerWithMocks();

      const result = await handler(
        createEvent({
          method: 'OPTIONS',
          path: '/pet/profile/me',
          resource: '/pet/profile/me',
          headers: { origin: 'https://app.example.test' },
        }),
        createContext()
      );

      expect(result.statusCode).toBe(204);
      expect(result.body).toBe('');
      expect(result.headers['Access-Control-Allow-Origin']).toBe('*');
      expect(result.headers['Access-Control-Allow-Methods']).toContain('OPTIONS');
    });

    test('rejects denied CORS preflight requests with 403', async () => {
      const { handler } = loadHandlerWithMocks({
        envOverrides: {
          ALLOWED_ORIGINS: 'https://allowed.example.test',
        },
      });

      const result = await handler(
        createEvent({
          method: 'OPTIONS',
          path: '/pet/profile/me',
          resource: '/pet/profile/me',
          headers: { origin: 'https://denied.example.test' },
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(403);
      expect(parsed.body.errorKey).toBe('common.originNotAllowed');
    });

    test('includes CORS headers on normal responses when origin is provided', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const petId = new mongoose.Types.ObjectId().toString();
      const { handler } = loadHandlerWithMocks({
        authUserId: userId,
        petDoc: {
          _id: petId,
          userId,
          name: 'Mochi',
          deleted: false,
        },
      });

      const result = await handler(
        createEvent({
          method: 'GET',
          path: `/pet/profile/${petId}`,
          resource: '/pet/profile/{petId}',
          pathParameters: { petId },
          headers: { origin: 'https://app.example.test' },
          authorizer: createAuthorizer({ userId }),
        }),
        createContext()
      );

      expect(result.statusCode).toBe(200);
      expect(result.headers['Access-Control-Allow-Origin']).toBe('*');
    });
  });

  describe('Happy-path flows', () => {
    test('returns private detail data for GET /pet/profile/{petId} when caller owns the pet', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const petId = new mongoose.Types.ObjectId().toString();
      const petDoc = {
        _id: petId,
        userId,
        name: 'Mochi',
        animal: 'Dog',
        sex: 'Female',
        birthday: new Date('2024-01-01T00:00:00.000Z'),
        tagId: 'TAG-001',
        ownerContact1: 91234567,
        deleted: false,
      };

      const { handler } = loadHandlerWithMocks({ authUserId: userId, petDoc });
      const result = await handler(
        createEvent({
          method: 'GET',
          path: `/pet/profile/${petId}`,
          resource: '/pet/profile/{petId}',
          pathParameters: { petId },
          authorizer: createAuthorizer({ userId }),
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(200);
      expect(parsed.body.success).toBe(true);
      expect(parsed.body.form.name).toBe('Mochi');
      expect(parsed.body.form.tagId).toBe('TAG-001');
      expect(parsed.body.form.ownerContact1).toBe(91234567);
    });

    test('returns narrowed summary data for GET /pet/profile/me user scope', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const { handler } = loadHandlerWithMocks({
        authUserId: userId,
        petList: [
          {
            _id: new mongoose.Types.ObjectId().toString(),
            userId,
            name: 'Mochi',
            animal: 'Dog',
            ownerContact1: 91234567,
            tagId: 'TAG-001',
            locationName: 'Shelter A',
          },
        ],
        petCount: 1,
      });

      const result = await handler(
        createEvent({
          method: 'GET',
          path: '/pet/profile/me',
          resource: '/pet/profile/me',
          authorizer: createAuthorizer({ userId }),
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(200);
      expect(parsed.body.total).toBe(1);
      expect(Array.isArray(parsed.body.form)).toBe(true);
      expect(parsed.body.form[0].name).toBe('Mochi');
      expect(parsed.body.form[0].location).toBe('Shelter A');
      expect(parsed.body.form[0].userId).toBeUndefined();
      expect(parsed.body.form[0].ownerContact1).toBeUndefined();
      expect(parsed.body.form[0].tagId).toBeUndefined();
    });

    test('returns NGO list results with paging and sort metadata', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const ngoId = new mongoose.Types.ObjectId().toString();
      const { handler, petModel, petFindChain } = loadHandlerWithMocks({
        authUserId: userId,
        authRole: 'ngo',
        authNgoId: ngoId,
        petList: [
          {
            _id: new mongoose.Types.ObjectId().toString(),
            name: 'Mochi',
            animal: 'Dog',
            ngoPetId: 'NGO00001',
          },
        ],
        petCount: 1,
      });

      const result = await handler(
        createEvent({
          method: 'GET',
          path: '/pet/profile/me',
          resource: '/pet/profile/me',
          authorizer: createAuthorizer({ userId, role: 'ngo', ngoId }),
          queryStringParameters: {
            search: 'Mochi',
            sortBy: 'name',
            sortOrder: 'asc',
            page: '2',
          },
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(200);
      expect(parsed.body.pets).toHaveLength(1);
      expect(parsed.body.total).toBe(1);
      expect(parsed.body.currentPage).toBe(2);
      expect(parsed.body.perPage).toBe(30);
      expect(petModel.find.mock.calls[0][0]).toMatchObject({
        ngoId,
        deleted: false,
      });
      expect(petFindChain.sort).toHaveBeenCalledWith({ name: 1, _id: -1 });
      expect(petFindChain.skip).toHaveBeenCalledWith(30);
      expect(petFindChain.limit).toHaveBeenCalledWith(30);
    });

    test('returns public-safe tag lookup data without auth', async () => {
      const { handler } = loadHandlerWithMocks({
        publicTagPet: {
          name: 'Mochi',
          animal: 'Dog',
          breed: 'Mixed',
          userId: new mongoose.Types.ObjectId().toString(),
        },
      });

      const result = await handler(
        createEvent({
          method: 'GET',
          path: '/pet/profile/by-tag/TAG-001',
          resource: '/pet/profile/by-tag/{tagId}',
          pathParameters: { tagId: 'TAG-001' },
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(200);
      expect(parsed.body.form.name).toBe('Mochi');
      expect(parsed.body.form.breed).toBe('Mixed');
      expect(parsed.body.form.userId).toBeUndefined();
      expect(parsed.body.form.ngoId).toBeUndefined();
    });

    test('creates a pet profile from JSON body input', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const { handler, petModel } = loadHandlerWithMocks({
        authUserId: userId,
        userDoc: { _id: userId, deleted: false },
      });

      const result = await handler(
        createEvent({
          method: 'POST',
          path: '/pet/profile',
          resource: '/pet/profile',
          body: JSON.stringify({
            name: 'Mochi',
            birthday: '2024-01-01',
            sex: 'Female',
            animal: 'Dog',
            tagId: 'TAG-001',
          }),
          authorizer: createAuthorizer({ userId }),
          headers: { 'content-type': 'application/json' },
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(201);
      expect(parsed.body.success).toBe(true);
      expect(parsed.body.message).toBe('Pet profile created successfully');
      expect(petModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          name: 'Mochi',
          animal: 'Dog',
          tagId: 'TAG-001',
          transferNGO: expect.any(Array),
        })
      );
    });

    test('creates a pet profile from multipart NGO input with uploaded image and generated NGO pet id', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const ngoId = new mongoose.Types.ObjectId().toString();
      const { handler, petModel, ngoCountersModel, imageCollectionModel, s3SendMock } = loadHandlerWithMocks({
        authUserId: userId,
        authRole: 'ngo',
        authNgoId: ngoId,
        userDoc: { _id: userId, deleted: false },
        multipartForm: {
          name: 'Mochi',
          animal: 'Dog',
          sex: 'Female',
          ngoId,
          ownerContact1: '91234567',
          files: [{ content: Buffer.from('abc'), filename: 'pet.png' }],
        },
      });

      const result = await handler(
        createEvent({
          method: 'POST',
          path: '/pet/profile',
          resource: '/pet/profile',
          body: 'multipart',
          authorizer: createAuthorizer({ userId, role: 'ngo', ngoId }),
          headers: { 'content-type': 'multipart/form-data; boundary=---abc' },
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      const createCall = petModel.create.mock.calls[0][0];

      expect(parsed.statusCode).toBe(201);
      expect(ngoCountersModel.findOneAndUpdate).toHaveBeenCalled();
      expect(imageCollectionModel.create).toHaveBeenCalled();
      expect(s3SendMock).toHaveBeenCalled();
      expect(createCall.ngoId).toBe(ngoId);
      expect(createCall.ngoPetId).toBe('NGO00001');
      expect(createCall.ownerContact1).toBe(91234567);
      expect(createCall.breedimage[0]).toContain('https://cdn.example.test/user-uploads/pets/');
    });

    test('updates a pet profile from JSON body input using the ownership filter', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const petId = new mongoose.Types.ObjectId().toString();
      const { handler, petModel } = loadHandlerWithMocks({
        authUserId: userId,
        petDoc: { _id: petId, userId, deleted: false },
        updatedPetDoc: {
          _id: petId,
          userId,
          name: 'Updated Mochi',
          locationName: 'Shelter A',
          deleted: false,
        },
      });

      const result = await handler(
        createEvent({
          method: 'PATCH',
          path: `/pet/profile/${petId}`,
          resource: '/pet/profile/{petId}',
          pathParameters: { petId },
          body: JSON.stringify({
            name: 'Updated Mochi',
            location: 'Shelter A',
          }),
          authorizer: createAuthorizer({ userId }),
          headers: { 'content-type': 'application/json' },
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      const [filter, update] = petModel.findOneAndUpdate.mock.calls[0];

      expect(parsed.statusCode).toBe(200);
      expect(parsed.body.form.name).toBe('Updated Mochi');
      expect(parsed.body.form.location).toBe('Shelter A');
      expect(filter).toMatchObject({
        _id: petId,
        deleted: false,
        $or: [{ userId }],
      });
      expect(update.$set.locationName).toBe('Shelter A');
      expect(update.$set.location).toBeUndefined();
    });

    test('updates multipart pet images and scalar fields in one request', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const petId = new mongoose.Types.ObjectId().toString();
      const save = jest.fn().mockResolvedValue(undefined);
      const petDoc = {
        _id: petId,
        userId,
        deleted: false,
        name: 'Mochi',
        breedimage: ['https://cdn.example.test/old-a.jpg', 'https://cdn.example.test/old-b.jpg'],
        save,
      };

      const { handler, imageCollectionModel, s3SendMock } = loadHandlerWithMocks({
        authUserId: userId,
        petDoc,
        multipartForm: {
          removedIndices: '[0]',
          name: 'Updated Mochi',
          files: [{ content: Buffer.from('abc'), filename: 'new.jpg' }],
        },
      });

      const result = await handler(
        createEvent({
          method: 'PATCH',
          path: `/pet/profile/${petId}`,
          resource: '/pet/profile/{petId}',
          pathParameters: { petId },
          body: 'multipart',
          authorizer: createAuthorizer({ userId }),
          headers: { 'content-type': 'multipart/form-data; boundary=---abc' },
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(200);
      expect(imageCollectionModel.create).toHaveBeenCalled();
      expect(s3SendMock).toHaveBeenCalled();
      expect(save).toHaveBeenCalledWith({ validateBeforeSave: true });
      expect(petDoc.name).toBe('Updated Mochi');
      expect(petDoc.breedimage).toHaveLength(2);
      expect(petDoc.breedimage[0]).toBe('https://cdn.example.test/old-b.jpg');
      expect(petDoc.breedimage[1]).toContain('https://cdn.example.test/user-uploads/pets/');
    });

    test('soft deletes a pet profile and clears the tag id', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const petId = new mongoose.Types.ObjectId().toString();
      const activePetDoc = {
        _id: petId,
        userId,
        deleted: false,
      };
      const deletedPetDoc = {
        _id: petId,
        userId,
        deleted: true,
      };

      const { handler, petModel } = loadHandlerWithMocks({
        authUserId: userId,
        petDoc: activePetDoc,
        updatedPetDoc: deletedPetDoc,
      });

      const result = await handler(
        createEvent({
          method: 'DELETE',
          path: `/pet/profile/${petId}`,
          resource: '/pet/profile/{petId}',
          pathParameters: { petId },
          authorizer: createAuthorizer({ userId }),
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      const [filter, update] = petModel.findOneAndUpdate.mock.calls[0];

      expect(parsed.statusCode).toBe(200);
      expect(parsed.body.petId).toBe(petId);
      expect(filter).toMatchObject({
        _id: petId,
        deleted: false,
        $or: [{ userId }],
      });
      expect(update).toEqual({ $set: { deleted: true, tagId: null } });
    });
  });

  describe('Input validation 400 responses', () => {
    test('rejects invalid pet ids on protected detail routes', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const { handler } = loadHandlerWithMocks({ authUserId: userId });

      const result = await handler(
        createEvent({
          method: 'GET',
          path: '/pet/profile/not-an-id',
          resource: '/pet/profile/{petId}',
          pathParameters: { petId: 'not-an-id' },
          authorizer: createAuthorizer({ userId }),
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(400);
      expect(parsed.body.errorKey).toBe('petProfile.errors.invalidPetId');
    });

    test('rejects public tag lookup when tagId is missing', async () => {
      const { handler } = loadHandlerWithMocks();

      const result = await handler(
        createEvent({
          method: 'GET',
          path: '/pet/profile/by-tag/',
          resource: '/pet/profile/by-tag/{tagId}',
          pathParameters: {},
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(400);
      expect(parsed.body.errorKey).toBe('petProfile.errors.missingTagId');
    });

    test('rejects invalid JSON create payloads with field-level validation keys', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const { handler, petModel } = loadHandlerWithMocks({
        authUserId: userId,
        userDoc: { _id: userId, deleted: false },
      });

      const result = await handler(
        createEvent({
          method: 'POST',
          path: '/pet/profile',
          resource: '/pet/profile',
          body: JSON.stringify({ name: '', sex: '', animal: '', birthday: 'bad-date' }),
          authorizer: createAuthorizer({ userId }),
          headers: { 'content-type': 'application/json' },
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(400);
      expect(parsed.body.errorKey).toBe('petProfile.errors.nameRequired');
      expect(petModel.create).not.toHaveBeenCalled();
    });

    test('rejects malformed JSON create bodies safely', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const { handler, petModel } = loadHandlerWithMocks({
        authUserId: userId,
      });

      const result = await handler(
        createEvent({
          method: 'POST',
          path: '/pet/profile',
          resource: '/pet/profile',
          body: '{"name":"Mochi"',
          authorizer: createAuthorizer({ userId }),
          headers: { 'content-type': 'application/json' },
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(400);
      expect(parsed.body.success).toBe(false);
      expect(parsed.body.errorKey).toEqual(expect.any(String));
      expect(parsed.body.errorKey).not.toBe('common.internalError');
      expect(petModel.create).not.toHaveBeenCalled();
    });

    test('rejects malicious extra fields on JSON create without mutating state', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const { handler, petModel } = loadHandlerWithMocks({
        authUserId: userId,
      });

      const result = await handler(
        createEvent({
          method: 'POST',
          path: '/pet/profile',
          resource: '/pet/profile',
          body: JSON.stringify({
            name: 'Mochi',
            birthday: '2024-01-01',
            sex: 'Female',
            animal: 'Dog',
            deleted: true,
            userId: 'attacker-id',
          }),
          authorizer: createAuthorizer({ userId }),
          headers: { 'content-type': 'application/json' },
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(400);
      expect(parsed.body.errorKey).toBe('petProfile.errors.invalidBodyParams');
      expect(petModel.create).not.toHaveBeenCalled();
    });

    test('rejects empty JSON patch bodies with common.noFieldsToUpdate', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const petId = new mongoose.Types.ObjectId().toString();
      const { handler, petModel } = loadHandlerWithMocks({
        authUserId: userId,
      });

      const result = await handler(
        createEvent({
          method: 'PATCH',
          path: `/pet/profile/${petId}`,
          resource: '/pet/profile/{petId}',
          pathParameters: { petId },
          body: JSON.stringify({}),
          authorizer: createAuthorizer({ userId }),
          headers: { 'content-type': 'application/json' },
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(400);
      expect(parsed.body.errorKey).toBe('common.noFieldsToUpdate');
      expect(petModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    test('rejects invalid JSON patch field types', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const petId = new mongoose.Types.ObjectId().toString();
      const { handler, petModel } = loadHandlerWithMocks({
        authUserId: userId,
      });

      const result = await handler(
        createEvent({
          method: 'PATCH',
          path: `/pet/profile/${petId}`,
          resource: '/pet/profile/{petId}',
          pathParameters: { petId },
          body: JSON.stringify({ weight: 'heavy' }),
          authorizer: createAuthorizer({ userId }),
          headers: { 'content-type': 'application/json' },
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(400);
      expect(parsed.body.errorKey).toBe('petProfile.errors.invalidWeightType');
      expect(petModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    test('rejects malformed JSON patch bodies safely', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const petId = new mongoose.Types.ObjectId().toString();
      const { handler, petModel } = loadHandlerWithMocks({
        authUserId: userId,
      });

      const result = await handler(
        createEvent({
          method: 'PATCH',
          path: `/pet/profile/${petId}`,
          resource: '/pet/profile/{petId}',
          pathParameters: { petId },
          body: '{"name":"Updated Mochi"',
          authorizer: createAuthorizer({ userId }),
          headers: { 'content-type': 'application/json' },
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(400);
      expect(parsed.body.success).toBe(false);
      expect(parsed.body.errorKey).toEqual(expect.any(String));
      expect(parsed.body.errorKey).not.toBe('common.internalError');
      expect(petModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    test('rejects multipart patch requests with invalid pet ids', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const { handler } = loadHandlerWithMocks({
        authUserId: userId,
        petDoc: {
          _id: new mongoose.Types.ObjectId().toString(),
          userId,
          deleted: false,
          breedimage: [],
          save: jest.fn().mockResolvedValue(undefined),
        },
        multipartForm: { files: [] },
      });

      const result = await handler(
        createEvent({
          method: 'PATCH',
          path: '/pet/profile/not-an-id',
          resource: '/pet/profile/{petId}',
          pathParameters: { petId: 'not-an-id' },
          body: 'multipart',
          authorizer: createAuthorizer({ userId }),
          headers: { 'content-type': 'multipart/form-data; boundary=---abc' },
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(400);
      expect(parsed.body.errorKey).toBe('petProfile.errors.invalidPetId');
    });

    test('rejects multipart patch requests that still send deprecated body petId', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const petId = new mongoose.Types.ObjectId().toString();
      const save = jest.fn().mockResolvedValue(undefined);
      const { handler, petModel } = loadHandlerWithMocks({
        authUserId: userId,
        petDoc: {
          _id: petId,
          userId,
          deleted: false,
          breedimage: [],
          save,
        },
        multipartForm: {
          petId,
          name: 'Updated Mochi',
          files: [],
        },
      });

      const result = await handler(
        createEvent({
          method: 'PATCH',
          path: `/pet/profile/${petId}`,
          resource: '/pet/profile/{petId}',
          pathParameters: { petId },
          body: 'multipart',
          authorizer: createAuthorizer({ userId }),
          headers: { 'content-type': 'multipart/form-data; boundary=---abc' },
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(400);
      expect(parsed.body.errorKey).toBe('petProfile.errors.invalidBodyParams');
      expect(save).not.toHaveBeenCalled();
      expect(petModel.findOne).not.toHaveBeenCalled();
    });

    test('rejects multipart patch requests with invalid removedIndices JSON', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const petId = new mongoose.Types.ObjectId().toString();
      const petDoc = {
        _id: petId,
        userId,
        deleted: false,
        breedimage: ['https://cdn.example.test/a.jpg'],
        save: jest.fn().mockResolvedValue(undefined),
      };
      const { handler } = loadHandlerWithMocks({
        authUserId: userId,
        petDoc,
        multipartForm: {
          removedIndices: 'bad-json',
          files: [],
        },
      });

      const result = await handler(
        createEvent({
          method: 'PATCH',
          path: `/pet/profile/${petId}`,
          resource: '/pet/profile/{petId}',
          pathParameters: { petId },
          body: 'multipart',
          authorizer: createAuthorizer({ userId }),
          headers: { 'content-type': 'multipart/form-data; boundary=---abc' },
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(400);
      expect(parsed.body.errorKey).toBe('petProfile.errors.invalidRemovedIndices');
    });

    test('rejects malicious extra fields in multipart patch without saving', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const petId = new mongoose.Types.ObjectId().toString();
      const save = jest.fn().mockResolvedValue(undefined);
      const petDoc = {
        _id: petId,
        userId,
        deleted: false,
        breedimage: [],
        save,
      };

      const { handler } = loadHandlerWithMocks({
        authUserId: userId,
        petDoc,
        multipartForm: {
          deleted: 'true',
          files: [],
        },
      });

      const result = await handler(
        createEvent({
          method: 'PATCH',
          path: `/pet/profile/${petId}`,
          resource: '/pet/profile/{petId}',
          pathParameters: { petId },
          body: 'multipart',
          authorizer: createAuthorizer({ userId }),
          headers: { 'content-type': 'multipart/form-data; boundary=---abc' },
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(400);
      expect(parsed.body.errorKey).toBe('petProfile.errors.invalidBodyParams');
      expect(save).not.toHaveBeenCalled();
    });

  });

  describe('Business logic, authentication, and authorization 4xx responses', () => {
    test('returns 409 for duplicate tag conflicts on JSON create', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const { handler } = loadHandlerWithMocks({
        authUserId: userId,
        userDoc: { _id: userId, deleted: false },
        duplicateTag: { _id: new mongoose.Types.ObjectId().toString() },
      });

      const result = await handler(
        createEvent({
          method: 'POST',
          path: '/pet/profile',
          resource: '/pet/profile',
          body: JSON.stringify({
            name: 'Mochi',
            birthday: '2024-01-01',
            sex: 'Female',
            animal: 'Dog',
            tagId: 'TAG-001',
          }),
          authorizer: createAuthorizer({ userId }),
          headers: { 'content-type': 'application/json' },
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(409);
      expect(parsed.body.errorKey).toBe('petProfile.errors.duplicatePetTag');
    });

    test('returns 404 when create caller user record no longer exists', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const { handler, petModel } = loadHandlerWithMocks({
        authUserId: userId,
        userDoc: null,
      });

      const result = await handler(
        createEvent({
          method: 'POST',
          path: '/pet/profile',
          resource: '/pet/profile',
          body: JSON.stringify({
            name: 'Mochi',
            birthday: '2024-01-01',
            sex: 'Female',
            animal: 'Dog',
          }),
          authorizer: createAuthorizer({ userId }),
          headers: { 'content-type': 'application/json' },
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(404);
      expect(parsed.body.errorKey).toBe('petProfile.errors.userNotFound');
      expect(petModel.create).not.toHaveBeenCalled();
    });

    test('returns 403 when non-NGO callers try multipart create with ngoId', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const { handler } = loadHandlerWithMocks({
        authUserId: userId,
        userDoc: { _id: userId, deleted: false },
        multipartForm: {
          name: 'Mochi',
          animal: 'Dog',
          sex: 'Female',
          ngoId: new mongoose.Types.ObjectId().toString(),
          files: [],
        },
      });

      const result = await handler(
        createEvent({
          method: 'POST',
          path: '/pet/profile',
          resource: '/pet/profile',
          body: 'multipart',
          authorizer: createAuthorizer({ userId }),
          headers: { 'content-type': 'multipart/form-data; boundary=---abc' },
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(403);
      expect(parsed.body.errorKey).toBe('petProfile.errors.ngoRoleRequired');
    });

    test('returns 403 when NGO multipart create is missing the NGO claim', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const requestedNgoId = new mongoose.Types.ObjectId().toString();
      const { handler } = loadHandlerWithMocks({
        authUserId: userId,
        authRole: 'ngo',
        authNgoId: undefined,
        userDoc: { _id: userId, deleted: false },
        multipartForm: {
          name: 'Mochi',
          animal: 'Dog',
          sex: 'Female',
          ngoId: requestedNgoId,
          files: [],
        },
      });

      const result = await handler(
        createEvent({
          method: 'POST',
          path: '/pet/profile',
          resource: '/pet/profile',
          body: 'multipart',
          authorizer: createAuthorizer({ userId, role: 'ngo' }),
          headers: { 'content-type': 'multipart/form-data; boundary=---abc' },
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(403);
      expect(parsed.body.errorKey).toBe('petProfile.errors.ngoIdClaimRequired');
    });

    test('returns 409 when generated NGO pet ids collide during multipart create', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const ngoId = new mongoose.Types.ObjectId().toString();
      const { handler, petModel } = loadHandlerWithMocks({
        authUserId: userId,
        authRole: 'ngo',
        authNgoId: ngoId,
        userDoc: { _id: userId, deleted: false },
        duplicateNgoPet: { _id: new mongoose.Types.ObjectId().toString() },
        multipartForm: {
          name: 'Mochi',
          animal: 'Dog',
          sex: 'Female',
          ngoId,
          files: [],
        },
      });

      const result = await handler(
        createEvent({
          method: 'POST',
          path: '/pet/profile',
          resource: '/pet/profile',
          body: 'multipart',
          authorizer: createAuthorizer({ userId, role: 'ngo', ngoId }),
          headers: { 'content-type': 'multipart/form-data; boundary=---abc' },
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(409);
      expect(parsed.body.errorKey).toBe('petProfile.errors.duplicateNgoPetId');
      expect(petModel.create).not.toHaveBeenCalled();
    });

    test('returns 403 for detail reads outside the caller ownership scope', async () => {
      const callerId = new mongoose.Types.ObjectId().toString();
      const ownerId = new mongoose.Types.ObjectId().toString();
      const petId = new mongoose.Types.ObjectId().toString();
      const { handler } = loadHandlerWithMocks({
        authUserId: callerId,
        petDoc: { _id: petId, userId: ownerId, deleted: false },
      });

      const result = await handler(
        createEvent({
          method: 'GET',
          path: `/pet/profile/${petId}`,
          resource: '/pet/profile/{petId}',
          pathParameters: { petId },
          authorizer: createAuthorizer({ userId: callerId }),
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(403);
      expect(parsed.body.errorKey).toBe('common.forbidden');
    });

    test('returns 403 for JSON patch requests outside the caller ownership scope', async () => {
      const callerId = new mongoose.Types.ObjectId().toString();
      const ownerId = new mongoose.Types.ObjectId().toString();
      const petId = new mongoose.Types.ObjectId().toString();
      const { handler, petModel } = loadHandlerWithMocks({
        authUserId: callerId,
        petDoc: { _id: petId, userId: ownerId, deleted: false },
      });

      const result = await handler(
        createEvent({
          method: 'PATCH',
          path: `/pet/profile/${petId}`,
          resource: '/pet/profile/{petId}',
          pathParameters: { petId },
          body: JSON.stringify({ name: 'Updated Mochi' }),
          authorizer: createAuthorizer({ userId: callerId }),
          headers: { 'content-type': 'application/json' },
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(403);
      expect(parsed.body.errorKey).toBe('common.forbidden');
      expect(petModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    test('returns 403 for delete requests outside the caller ownership scope', async () => {
      const callerId = new mongoose.Types.ObjectId().toString();
      const ownerId = new mongoose.Types.ObjectId().toString();
      const petId = new mongoose.Types.ObjectId().toString();
      const { handler, petModel } = loadHandlerWithMocks({
        authUserId: callerId,
        petDoc: { _id: petId, userId: ownerId, deleted: false },
      });

      const result = await handler(
        createEvent({
          method: 'DELETE',
          path: `/pet/profile/${petId}`,
          resource: '/pet/profile/{petId}',
          pathParameters: { petId },
          authorizer: createAuthorizer({ userId: callerId }),
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(403);
      expect(parsed.body.errorKey).toBe('common.forbidden');
      expect(petModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    test('returns 409 when deleting an already deleted pet', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const petId = new mongoose.Types.ObjectId().toString();
      const activePetDoc = {
        _id: petId,
        userId,
        deleted: false,
      };
      const deletedPetDoc = {
        _id: petId,
        userId,
        deleted: true,
      };

      const { handler } = loadHandlerWithMocks({
        authUserId: userId,
        petDoc: activePetDoc,
        fallbackPetDoc: deletedPetDoc,
        updatedPetDoc: null,
      });

      const result = await handler(
        createEvent({
          method: 'DELETE',
          path: `/pet/profile/${petId}`,
          resource: '/pet/profile/{petId}',
          pathParameters: { petId },
          authorizer: createAuthorizer({ userId }),
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(409);
      expect(parsed.body.errorKey).toBe('petProfile.errors.petAlreadyDeleted');
    });

    test('returns 404 when delete loses the target after the auth read', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const petId = new mongoose.Types.ObjectId().toString();
      const activePetDoc = {
        _id: petId,
        userId,
        deleted: false,
      };

      const { handler } = loadHandlerWithMocks({
        authUserId: userId,
        petDoc: activePetDoc,
        fallbackPetDoc: null,
        updatedPetDoc: null,
      });

      const result = await handler(
        createEvent({
          method: 'DELETE',
          path: `/pet/profile/${petId}`,
          resource: '/pet/profile/{petId}',
          pathParameters: { petId },
          authorizer: createAuthorizer({ userId }),
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(404);
      expect(parsed.body.errorKey).toBe('petProfile.errors.petNotFound');
    });

    test('returns 404 for NGO list requests when no pets match', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const ngoId = new mongoose.Types.ObjectId().toString();
      const { handler } = loadHandlerWithMocks({
        authUserId: userId,
        authRole: 'ngo',
        authNgoId: ngoId,
        petList: [],
        petCount: 0,
      });

      const result = await handler(
        createEvent({
          method: 'GET',
          path: '/pet/profile/me',
          resource: '/pet/profile/me',
          authorizer: createAuthorizer({ userId, role: 'ngo', ngoId }),
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(404);
      expect(parsed.body.errorKey).toBe('petProfile.errors.noPetsFound');
    });

    test('returns a successful null-filled public tag lookup when no pet matches', async () => {
      const { handler } = loadHandlerWithMocks({
        publicTagPet: null,
      });

      const result = await handler(
        createEvent({
          method: 'GET',
          path: '/pet/profile/by-tag/TAG-404',
          resource: '/pet/profile/by-tag/{tagId}',
          pathParameters: { tagId: 'TAG-404' },
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(200);
      expect(parsed.body.form.name).toBeNull();
      expect(parsed.body.form.breedimage).toBeNull();
      expect(parsed.body.form.status).toBeNull();
    });

    test('returns 429 when create is over the configured rate limit', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const { handler } = loadHandlerWithMocks({
        authUserId: userId,
        userDoc: { _id: userId, deleted: false },
        rateLimitEntry: {
          count: 21,
          expireAt: new Date(Date.now() + 60_000),
          windowStart: new Date(),
        },
      });

      const result = await handler(
        createEvent({
          method: 'POST',
          path: '/pet/profile',
          resource: '/pet/profile',
          body: JSON.stringify({
            name: 'Mochi',
            birthday: '2024-01-01',
            sex: 'Female',
            animal: 'Dog',
          }),
          authorizer: createAuthorizer({ userId }),
          headers: { 'content-type': 'application/json' },
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(429);
      expect(parsed.body.errorKey).toBe('common.rateLimited');
      expect(result.headers['retry-after']).toEqual(expect.any(String));
    });

    test('returns 403 for multipart patch ngoId mismatch attempts', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const ngoId = new mongoose.Types.ObjectId().toString();
      const otherNgoId = new mongoose.Types.ObjectId().toString();
      const petId = new mongoose.Types.ObjectId().toString();
      const save = jest.fn().mockResolvedValue(undefined);
      const petDoc = {
        _id: petId,
        userId,
        ngoId,
        deleted: false,
        breedimage: [],
        save,
      };

      const { handler } = loadHandlerWithMocks({
        authUserId: userId,
        authRole: 'ngo',
        authNgoId: ngoId,
        petDoc,
        multipartForm: {
          ngoId: otherNgoId,
          files: [],
        },
      });

      const result = await handler(
        createEvent({
          method: 'PATCH',
          path: `/pet/profile/${petId}`,
          resource: '/pet/profile/{petId}',
          pathParameters: { petId },
          body: 'multipart',
          authorizer: createAuthorizer({ userId, role: 'ngo', ngoId }),
          headers: { 'content-type': 'multipart/form-data; boundary=---abc' },
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(403);
      expect(parsed.body.errorKey).toBe('common.forbidden');
      expect(save).not.toHaveBeenCalled();
    });

    test('returns 403 for multipart ngoPetId escalation attempts by non-NGO owners', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const petId = new mongoose.Types.ObjectId().toString();
      const save = jest.fn().mockResolvedValue(undefined);
      const petDoc = {
        _id: petId,
        userId,
        deleted: false,
        breedimage: [],
        save,
      };

      const { handler } = loadHandlerWithMocks({
        authUserId: userId,
        petDoc,
        multipartForm: {
          ngoPetId: 'NGO00099',
          files: [],
        },
      });

      const result = await handler(
        createEvent({
          method: 'PATCH',
          path: `/pet/profile/${petId}`,
          resource: '/pet/profile/{petId}',
          pathParameters: { petId },
          body: 'multipart',
          authorizer: createAuthorizer({ userId }),
          headers: { 'content-type': 'multipart/form-data; boundary=---abc' },
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(403);
      expect(parsed.body.errorKey).toBe('common.forbidden');
      expect(save).not.toHaveBeenCalled();
    });
  });

  describe('Cyberattack and abuse coverage', () => {
    test('rejects JSON patch mass assignment attempts against isRegistered without mutating state', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const petId = new mongoose.Types.ObjectId().toString();
      const { handler, petModel } = loadHandlerWithMocks({
        authUserId: userId,
        petDoc: { _id: petId, userId, deleted: false },
      });

      const result = await handler(
        createEvent({
          method: 'PATCH',
          path: `/pet/profile/${petId}`,
          resource: '/pet/profile/{petId}',
          pathParameters: { petId },
          body: JSON.stringify({ isRegistered: true }),
          authorizer: createAuthorizer({ userId }),
          headers: { 'content-type': 'application/json' },
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(400);
      expect(parsed.body.errorKey).toBe('petProfile.errors.invalidBodyParams');
      expect(petModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    test('rejects NoSQL-style JSON patch operator injection without mutating state', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const petId = new mongoose.Types.ObjectId().toString();
      const { handler, petModel } = loadHandlerWithMocks({
        authUserId: userId,
        petDoc: { _id: petId, userId, deleted: false },
      });

      const result = await handler(
        createEvent({
          method: 'PATCH',
          path: `/pet/profile/${petId}`,
          resource: '/pet/profile/{petId}',
          pathParameters: { petId },
          body: JSON.stringify({ name: { $gt: '' } }),
          authorizer: createAuthorizer({ userId }),
          headers: { 'content-type': 'application/json' },
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(400);
      expect(parsed.body.success).toBe(false);
      expect(parsed.body.errorKey).toEqual(expect.any(String));
      expect(petModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    test('escapes regex metacharacters in NGO list search input', async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const ngoId = new mongoose.Types.ObjectId().toString();
      const { handler, petModel } = loadHandlerWithMocks({
        authUserId: userId,
        authRole: 'ngo',
        authNgoId: ngoId,
        petList: [
          {
            _id: new mongoose.Types.ObjectId().toString(),
            name: 'Mochi',
          },
        ],
        petCount: 1,
      });

      const result = await handler(
        createEvent({
          method: 'GET',
          path: '/pet/profile/me',
          resource: '/pet/profile/me',
          authorizer: createAuthorizer({ userId, role: 'ngo', ngoId }),
          queryStringParameters: {
            search: 'a.*(b)?$',
          },
        }),
        createContext()
      );

      const parsed = parseResponse(result);
      const query = petModel.find.mock.calls[0][0];

      expect(parsed.statusCode).toBe(200);
      expect(query.$or[0].name.$regex).toBe('a\\.\\*\\(b\\)\\?\\$');
      expect(query.$or[1].animal.$regex).toBe('a\\.\\*\\(b\\)\\?\\$');
    });
  });

  describe('Infrastructure contract checks', () => {
    test('template keeps by-tag GET and OPTIONS routes public without API key', async () => {
      const template = fs.readFileSync(templatePath, 'utf8');

      expect(template).toMatch(/PetProfileByTagGET:[\s\S]*?Path: \/pet\/profile\/by-tag\/\{tagId\}[\s\S]*?Authorizer: NONE[\s\S]*?ApiKeyRequired: false/);
      expect(template).toMatch(/PetProfileByTagOPTIONS:[\s\S]*?Path: \/pet\/profile\/by-tag\/\{tagId\}[\s\S]*?Authorizer: NONE[\s\S]*?ApiKeyRequired: false/);
    });

    test('template grants pet-profile its dedicated S3 upload role', async () => {
      const template = fs.readFileSync(templatePath, 'utf8');

      expect(template).toMatch(/PetProfileFunctionRole:[\s\S]*?PolicyName: !Sub '\$\{ProjectName\}-\$\{StageName\}-pet-profile-s3-upload'[\s\S]*?s3:PutObject[\s\S]*?s3:PutObjectAcl[\s\S]*?arn:aws:s3:::\$\{S3BucketName\}\/user-uploads\/pets\/\*/);
      expect(template).toMatch(/PetProfileFunction:[\s\S]*?Role: !GetAtt PetProfileFunctionRole\.Arn/);
    });
  });

  describe('Deferred higher-tier proof', () => {
    test.todo('Tier 3: local SAM HTTP integration through template.yaml and sam local start-api');
    test.todo('Tier 4: DB-backed UAT covering persistence, repeated request stability, and delete/read/patch state transitions');
  });
});
