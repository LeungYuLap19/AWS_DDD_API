const path = require('path');
const mongoose = require('mongoose');

const handlerModulePath = path.resolve(__dirname, '../dist/functions/pet-medical/index.js');
const sharedRuntimeModulePath = path.resolve(
  __dirname,
  '../dist/layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/index.js'
);

function createContext() {
  return {
    awsRequestId: 'req-pet-medical-handler',
    callbackWaitsForEmptyEventLoop: true,
  };
}

function createAuthorizer({
  userId = new mongoose.Types.ObjectId().toString(),
  role = 'user',
  ngoId,
} = {}) {
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
      requestId: 'req-pet-medical-handler',
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

function createLeanResult(value) {
  return {
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(value),
    exec: jest.fn().mockResolvedValue(value),
  };
}

/**
 * Build the mocked handler with configurable Pet ownership and per-collection
 * record stores. Each record collection uses the same generic mock object so
 * tests can configure expected values per call.
 */
function loadHandlerWithMocks({
  authUserId = new mongoose.Types.ObjectId().toString(),
  authRole = 'user',
  authNgoId,
  petDoc, // controls Pet.findOne result
  rateLimitEntry = {
    count: 1,
    expireAt: new Date(Date.now() + 60_000),
    windowStart: new Date(),
  },
} = {}) {
  jest.resetModules();
  jest.clearAllMocks();
  resetEnv();

  const actualMongoose = jest.requireActual('mongoose');

  const petFindOne = jest.fn(() => createLeanResult(petDoc === undefined ? null : petDoc));
  const petFindOneAndUpdate = jest.fn().mockResolvedValue({});
  const petFindByIdAndUpdate = jest.fn().mockResolvedValue({});

  function makeRecordModel() {
    return {
      find: jest.fn(() => createLeanResult([])),
      findOneAndUpdate: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
      create: jest.fn().mockResolvedValue({ _id: new actualMongoose.Types.ObjectId() }),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 0 }),
      countDocuments: jest.fn().mockResolvedValue(0),
    };
  }

  const petModel = {
    findOne: petFindOne,
    findOneAndUpdate: petFindOneAndUpdate,
    findByIdAndUpdate: petFindByIdAndUpdate,
  };
  const medicalModel = makeRecordModel();
  const medicationModel = makeRecordModel();
  const dewormModel = makeRecordModel();
  const bloodTestModel = makeRecordModel();
  const rateLimitModel = {
    findOneAndUpdate: jest.fn().mockResolvedValue(rateLimitEntry),
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
      if (name === 'Medical_Records') return medicalModel;
      if (name === 'Medication_Records') return medicationModel;
      if (name === 'Deworm_Records') return dewormModel;
      if (name === 'blood_tests') return bloodTestModel;
      if (name === 'RateLimit' || name === 'MongoRateLimit') return rateLimitModel;
      throw new Error(`Unexpected model ${name}`);
    }),
  };

  jest.doMock('mongoose', () => ({ __esModule: true, default: mongooseMock }));
  jest.doMock('@aws-ddd-api/shared', () => require(sharedRuntimeModulePath), { virtual: true });

  const { handler } = require(handlerModulePath);
  const authorizer = createAuthorizer({
    userId: authUserId,
    role: authRole,
    ngoId: authRole === 'ngo' ? authNgoId : undefined,
  });

  return {
    handler,
    authorizer,
    petModel,
    medicalModel,
    medicationModel,
    dewormModel,
    bloodTestModel,
    rateLimitModel,
    mongooseMock,
  };
}

let consoleLogSpy, consoleWarnSpy, consoleErrorSpy;
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

describe('pet-medical handler Tier 2 integration', () => {
  describe('Router proofs', () => {
    test('returns 404 for unknown route', async () => {
      const { handler, authorizer } = loadHandlerWithMocks();
      const result = await handler(
        createEvent({
          method: 'GET',
          path: '/pet/medical/unknown/path',
          resource: '/pet/medical/unknown/path',
          authorizer,
        }),
        createContext()
      );
      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(404);
      expect(parsed.body.errorKey).toBe('common.routeNotFound');
    });

    test('returns 405 when method not allowed for known resource', async () => {
      const petId = new mongoose.Types.ObjectId().toString();
      const { handler, authorizer } = loadHandlerWithMocks();
      const result = await handler(
        createEvent({
          method: 'PUT',
          path: `/pet/medical/${petId}/general`,
          resource: '/pet/medical/{petId}/general',
          pathParameters: { petId },
          authorizer,
        }),
        createContext()
      );
      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(405);
      expect(parsed.body.errorKey).toBe('common.methodNotAllowed');
    });

    test('returns 401 when authorizer context missing', async () => {
      const petId = new mongoose.Types.ObjectId().toString();
      const { handler } = loadHandlerWithMocks();
      const result = await handler(
        createEvent({
          method: 'GET',
          path: `/pet/medical/${petId}/general`,
          resource: '/pet/medical/{petId}/general',
          pathParameters: { petId },
        }),
        createContext()
      );
      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(401);
      expect(parsed.body.errorKey).toBe('common.unauthorized');
    });
  });

  describe('Authorization (loadAuthorizedPet)', () => {
    test('returns 400 when petId is not a valid ObjectId', async () => {
      const { handler, authorizer } = loadHandlerWithMocks();
      const result = await handler(
        createEvent({
          method: 'GET',
          path: '/pet/medical/not-an-objectid/general',
          resource: '/pet/medical/{petId}/general',
          pathParameters: { petId: 'not-an-objectid' },
          authorizer,
        }),
        createContext()
      );
      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(400);
      expect(parsed.body.errorKey).toBe('petMedicalRecord.errors.invalidPetIdFormat');
    });

    test('returns 404 when pet does not exist', async () => {
      const petId = new mongoose.Types.ObjectId().toString();
      const { handler, authorizer } = loadHandlerWithMocks({ petDoc: null });
      const result = await handler(
        createEvent({
          method: 'GET',
          path: `/pet/medical/${petId}/general`,
          resource: '/pet/medical/{petId}/general',
          pathParameters: { petId },
          authorizer,
        }),
        createContext()
      );
      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(404);
      expect(parsed.body.errorKey).toBe('petMedicalRecord.errors.petNotFound');
    });

    test('returns 403 when caller is not pet owner and not NGO owner', async () => {
      const petId = new mongoose.Types.ObjectId().toString();
      const otherUserId = new mongoose.Types.ObjectId().toString();
      const { handler, authorizer } = loadHandlerWithMocks({
        petDoc: { _id: petId, userId: otherUserId, ngoId: null },
      });
      const result = await handler(
        createEvent({
          method: 'GET',
          path: `/pet/medical/${petId}/general`,
          resource: '/pet/medical/{petId}/general',
          pathParameters: { petId },
          authorizer,
        }),
        createContext()
      );
      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(403);
      expect(parsed.body.errorKey).toBe('common.forbidden');
    });

    test('allows access when caller is NGO owner with matching ngoId', async () => {
      const petId = new mongoose.Types.ObjectId().toString();
      const ngoId = new mongoose.Types.ObjectId().toString();
      const { handler, authorizer, medicalModel } = loadHandlerWithMocks({
        authRole: 'ngo',
        authNgoId: ngoId,
        petDoc: { _id: petId, userId: null, ngoId },
      });
      const records = [
        {
          _id: new mongoose.Types.ObjectId().toString(),
          petId,
          medicalDate: new Date('2024-05-10'),
          medicalPlace: 'Clinic A',
          medicalDoctor: 'Dr. Lee',
          medicalResult: 'Healthy',
          medicalSolution: 'None',
        },
      ];
      medicalModel.find.mockReturnValueOnce(createLeanResult(records));

      const result = await handler(
        createEvent({
          method: 'GET',
          path: `/pet/medical/${petId}/general`,
          resource: '/pet/medical/{petId}/general',
          pathParameters: { petId },
          authorizer,
        }),
        createContext()
      );
      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(200);
      expect(parsed.body.message).toBe('Pet medical record retrieved successfully');
      expect(parsed.body.form.medical).toHaveLength(1);
    });
  });

  describe('Medical records CRUD', () => {
    function ownPet(authUserId) {
      const petId = new mongoose.Types.ObjectId().toString();
      return { petId, petDoc: { _id: petId, userId: authUserId, ngoId: null } };
    }

    test('GET list returns success', async () => {
      const authUserId = new mongoose.Types.ObjectId().toString();
      const { petId, petDoc } = ownPet(authUserId);
      const { handler, authorizer, medicalModel } = loadHandlerWithMocks({ authUserId, petDoc });
      medicalModel.find.mockReturnValueOnce(createLeanResult([]));
      const result = await handler(
        createEvent({
          method: 'GET',
          path: `/pet/medical/${petId}/general`,
          resource: '/pet/medical/{petId}/general',
          pathParameters: { petId },
          authorizer,
        }),
        createContext()
      );
      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(200);
      expect(parsed.body.form.medical).toEqual([]);
      expect(parsed.body.petId).toBe(petId);
    });

    test('POST create with valid date returns 201 without touching Pet summary counters', async () => {
      const authUserId = new mongoose.Types.ObjectId().toString();
      const { petId, petDoc } = ownPet(authUserId);
      const { handler, authorizer, medicalModel, petModel } = loadHandlerWithMocks({
        authUserId,
        petDoc,
      });
      const newId = new mongoose.Types.ObjectId();
      medicalModel.create.mockResolvedValueOnce({
        _id: newId,
        toObject: () => ({
          _id: newId,
          petId,
          medicalDate: new Date('2024-05-10'),
          medicalPlace: 'Clinic A',
        }),
      });

      const result = await handler(
        createEvent({
          method: 'POST',
          path: `/pet/medical/${petId}/general`,
          resource: '/pet/medical/{petId}/general',
          pathParameters: { petId },
          body: JSON.stringify({ medicalDate: '2024-05-10', medicalPlace: 'Clinic A' }),
          authorizer,
        }),
        createContext()
      );
      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(201);
      expect(parsed.body.message).toBe('Pet medical record created successfully');
      // Summary counters are dropped from pet-medical; Pet.findOneAndUpdate is
      // never called on POST.
      expect(petModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    test('POST create with invalid date returns 400', async () => {
      const authUserId = new mongoose.Types.ObjectId().toString();
      const { petId, petDoc } = ownPet(authUserId);
      const { handler, authorizer } = loadHandlerWithMocks({ authUserId, petDoc });
      const result = await handler(
        createEvent({
          method: 'POST',
          path: `/pet/medical/${petId}/general`,
          resource: '/pet/medical/{petId}/general',
          pathParameters: { petId },
          body: JSON.stringify({ medicalDate: 'not-a-date' }),
          authorizer,
        }),
        createContext()
      );
      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(400);
      expect(parsed.body.errorKey).toBe(
        'petMedicalRecord.errors.medicalRecord.invalidDateFormat'
      );
    });

    test('POST create with empty body returns 400 missingBodyParams', async () => {
      const authUserId = new mongoose.Types.ObjectId().toString();
      const { petId, petDoc } = ownPet(authUserId);
      const { handler, authorizer } = loadHandlerWithMocks({ authUserId, petDoc });
      const result = await handler(
        createEvent({
          method: 'POST',
          path: `/pet/medical/${petId}/general`,
          resource: '/pet/medical/{petId}/general',
          pathParameters: { petId },
          body: JSON.stringify({}),
          authorizer,
        }),
        createContext()
      );
      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(400);
      expect(parsed.body.errorKey).toBe('common.missingBodyParams');
    });

    test('POST create rejects unknown fields (Zod .strict)', async () => {
      const authUserId = new mongoose.Types.ObjectId().toString();
      const { petId, petDoc } = ownPet(authUserId);
      const { handler, authorizer } = loadHandlerWithMocks({ authUserId, petDoc });
      const result = await handler(
        createEvent({
          method: 'POST',
          path: `/pet/medical/${petId}/general`,
          resource: '/pet/medical/{petId}/general',
          pathParameters: { petId },
          body: JSON.stringify({ medicalPlace: 'X', $where: 'evil' }),
          authorizer,
        }),
        createContext()
      );
      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(400);
    });

    test('PATCH update with invalid medicalId returns 400', async () => {
      const authUserId = new mongoose.Types.ObjectId().toString();
      const { petId, petDoc } = ownPet(authUserId);
      const { handler, authorizer } = loadHandlerWithMocks({ authUserId, petDoc });
      const result = await handler(
        createEvent({
          method: 'PATCH',
          path: `/pet/medical/${petId}/general/bogus`,
          resource: '/pet/medical/{petId}/general/{medicalId}',
          pathParameters: { petId, medicalId: 'bogus' },
          body: JSON.stringify({ medicalPlace: 'X' }),
          authorizer,
        }),
        createContext()
      );
      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(400);
      expect(parsed.body.errorKey).toBe(
        'petMedicalRecord.errors.medicalRecord.invalidMedicalIdFormat'
      );
    });

    test('PATCH update with empty body returns 400 missingBodyParams', async () => {
      const authUserId = new mongoose.Types.ObjectId().toString();
      const { petId, petDoc } = ownPet(authUserId);
      const medicalId = new mongoose.Types.ObjectId().toString();
      const { handler, authorizer } = loadHandlerWithMocks({ authUserId, petDoc });
      const result = await handler(
        createEvent({
          method: 'PATCH',
          path: `/pet/medical/${petId}/general/${medicalId}`,
          resource: '/pet/medical/{petId}/general/{medicalId}',
          pathParameters: { petId, medicalId },
          body: JSON.stringify({}),
          authorizer,
        }),
        createContext()
      );
      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(400);
      expect(parsed.body.errorKey).toBe('common.missingBodyParams');
    });

    test('PATCH update returns 404 when record not found', async () => {
      const authUserId = new mongoose.Types.ObjectId().toString();
      const { petId, petDoc } = ownPet(authUserId);
      const medicalId = new mongoose.Types.ObjectId().toString();
      const { handler, authorizer, medicalModel } = loadHandlerWithMocks({
        authUserId,
        petDoc,
      });
      medicalModel.findOneAndUpdate.mockReturnValueOnce({
        lean: jest.fn().mockResolvedValue(null),
      });
      const result = await handler(
        createEvent({
          method: 'PATCH',
          path: `/pet/medical/${petId}/general/${medicalId}`,
          resource: '/pet/medical/{petId}/general/{medicalId}',
          pathParameters: { petId, medicalId },
          body: JSON.stringify({ medicalPlace: 'X' }),
          authorizer,
        }),
        createContext()
      );
      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(404);
      expect(parsed.body.errorKey).toBe('petMedicalRecord.errors.medicalRecord.notFound');
    });

    test('PATCH update happy path returns 200', async () => {
      const authUserId = new mongoose.Types.ObjectId().toString();
      const { petId, petDoc } = ownPet(authUserId);
      const medicalId = new mongoose.Types.ObjectId().toString();
      const { handler, authorizer, medicalModel } = loadHandlerWithMocks({
        authUserId,
        petDoc,
      });
      medicalModel.findOneAndUpdate.mockReturnValueOnce({
        lean: jest.fn().mockResolvedValue({
          _id: medicalId,
          petId,
          medicalPlace: 'Clinic Z',
        }),
      });
      const result = await handler(
        createEvent({
          method: 'PATCH',
          path: `/pet/medical/${petId}/general/${medicalId}`,
          resource: '/pet/medical/{petId}/general/{medicalId}',
          pathParameters: { petId, medicalId },
          body: JSON.stringify({ medicalPlace: 'Clinic Z' }),
          authorizer,
        }),
        createContext()
      );
      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(200);
      expect(parsed.body.message).toBe('Pet medical record updated successfully');
      expect(parsed.body.medicalRecordId).toBe(medicalId);
    });

    test('DELETE returns 404 when nothing deleted', async () => {
      const authUserId = new mongoose.Types.ObjectId().toString();
      const { petId, petDoc } = ownPet(authUserId);
      const medicalId = new mongoose.Types.ObjectId().toString();
      const { handler, authorizer, medicalModel } = loadHandlerWithMocks({
        authUserId,
        petDoc,
      });
      medicalModel.deleteOne.mockResolvedValueOnce({ deletedCount: 0 });
      const result = await handler(
        createEvent({
          method: 'DELETE',
          path: `/pet/medical/${petId}/general/${medicalId}`,
          resource: '/pet/medical/{petId}/general/{medicalId}',
          pathParameters: { petId, medicalId },
          authorizer,
        }),
        createContext()
      );
      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(404);
    });

    test('DELETE happy path returns 200 without writing summary counters', async () => {
      const authUserId = new mongoose.Types.ObjectId().toString();
      const { petId, petDoc } = ownPet(authUserId);
      const medicalId = new mongoose.Types.ObjectId().toString();
      const { handler, authorizer, medicalModel, petModel } = loadHandlerWithMocks({
        authUserId,
        petDoc,
      });
      medicalModel.deleteOne.mockResolvedValueOnce({ deletedCount: 1 });
      const result = await handler(
        createEvent({
          method: 'DELETE',
          path: `/pet/medical/${petId}/general/${medicalId}`,
          resource: '/pet/medical/{petId}/general/{medicalId}',
          pathParameters: { petId, medicalId },
          authorizer,
        }),
        createContext()
      );
      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(200);
      expect(medicalModel.countDocuments).not.toHaveBeenCalled();
      expect(petModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe('Medication records', () => {
    test('POST create does not touch Pet summary counters', async () => {
      const authUserId = new mongoose.Types.ObjectId().toString();
      const petId = new mongoose.Types.ObjectId().toString();
      const { handler, authorizer, medicationModel, petModel } = loadHandlerWithMocks({
        authUserId,
        petDoc: { _id: petId, userId: authUserId, ngoId: null },
      });
      medicationModel.create.mockResolvedValueOnce({
        _id: new mongoose.Types.ObjectId(),
        toObject: () => ({ drugName: 'Aspirin' }),
      });
      const result = await handler(
        createEvent({
          method: 'POST',
          path: `/pet/medical/${petId}/medication`,
          resource: '/pet/medical/{petId}/medication',
          pathParameters: { petId },
          body: JSON.stringify({ drugName: 'Aspirin', allergy: false }),
          authorizer,
        }),
        createContext()
      );
      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(201);
      expect(petModel.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe('Deworm records', () => {
    test('POST create does not touch Pet summary counters or latestDewormDate', async () => {
      const authUserId = new mongoose.Types.ObjectId().toString();
      const petId = new mongoose.Types.ObjectId().toString();
      const { handler, authorizer, dewormModel, petModel } = loadHandlerWithMocks({
        authUserId,
        petDoc: { _id: petId, userId: authUserId, ngoId: null },
      });
      dewormModel.create.mockResolvedValueOnce({
        _id: new mongoose.Types.ObjectId(),
        toObject: () => ({ vaccineBrand: 'Brand X' }),
      });
      const result = await handler(
        createEvent({
          method: 'POST',
          path: `/pet/medical/${petId}/deworming`,
          resource: '/pet/medical/{petId}/deworming',
          pathParameters: { petId },
          body: JSON.stringify({ date: '2024-05-10', vaccineBrand: 'Brand X' }),
          authorizer,
        }),
        createContext()
      );
      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(201);
      expect(petModel.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe('Blood-test records', () => {
    test('POST create does not touch Pet summary counters or latestBloodTestDate', async () => {
      const authUserId = new mongoose.Types.ObjectId().toString();
      const petId = new mongoose.Types.ObjectId().toString();
      const { handler, authorizer, bloodTestModel, petModel } = loadHandlerWithMocks({
        authUserId,
        petDoc: { _id: petId, userId: authUserId, ngoId: null },
      });
      bloodTestModel.create.mockResolvedValueOnce({
        _id: new mongoose.Types.ObjectId(),
        toObject: () => ({ heartworm: 'negative' }),
      });
      const result = await handler(
        createEvent({
          method: 'POST',
          path: `/pet/medical/${petId}/blood-test`,
          resource: '/pet/medical/{petId}/blood-test',
          pathParameters: { petId },
          body: JSON.stringify({ bloodTestDate: '2024-05-10', heartworm: 'negative' }),
          authorizer,
        }),
        createContext()
      );
      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(201);
      expect(petModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    test('GET list returns blood_test array on getSuccess message', async () => {
      const authUserId = new mongoose.Types.ObjectId().toString();
      const petId = new mongoose.Types.ObjectId().toString();
      const { handler, authorizer, bloodTestModel } = loadHandlerWithMocks({
        authUserId,
        petDoc: { _id: petId, userId: authUserId, ngoId: null },
      });
      bloodTestModel.find.mockReturnValueOnce(createLeanResult([]));
      const result = await handler(
        createEvent({
          method: 'GET',
          path: `/pet/medical/${petId}/blood-test`,
          resource: '/pet/medical/{petId}/blood-test',
          pathParameters: { petId },
          authorizer,
        }),
        createContext()
      );
      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(200);
      expect(parsed.body.message).toBe('Pet blood test records retrieved successfully');
      expect(parsed.body.form.blood_test).toEqual([]);
    });
  });

  describe('Body parsing', () => {
    test('returns 400 invalidJSON for malformed JSON', async () => {
      const authUserId = new mongoose.Types.ObjectId().toString();
      const petId = new mongoose.Types.ObjectId().toString();
      const { handler, authorizer } = loadHandlerWithMocks({
        authUserId,
        petDoc: { _id: petId, userId: authUserId, ngoId: null },
      });
      const result = await handler(
        createEvent({
          method: 'POST',
          path: `/pet/medical/${petId}/general`,
          resource: '/pet/medical/{petId}/general',
          pathParameters: { petId },
          body: '{not-json',
          authorizer,
        }),
        createContext()
      );
      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(400);
      expect(parsed.body.errorKey).toBe('common.invalidBodyParams');
    });

    test('explicit null body is rejected as missingBodyParams (shared parseBody requireNonEmpty default)', async () => {
      const authUserId = new mongoose.Types.ObjectId().toString();
      const petId = new mongoose.Types.ObjectId().toString();
      const { handler, authorizer } = loadHandlerWithMocks({
        authUserId,
        petDoc: { _id: petId, userId: authUserId, ngoId: null },
      });
      const result = await handler(
        createEvent({
          method: 'POST',
          path: `/pet/medical/${petId}/general`,
          resource: '/pet/medical/{petId}/general',
          pathParameters: { petId },
          body: null,
          authorizer,
        }),
        createContext()
      );
      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(400);
      expect(parsed.body.errorKey).toBe('common.missingBodyParams');
    });
  });

  describe('Summary fields are no longer maintained (no counter race possible)', () => {
    test('PATCH on deworming does not touch Pet summary fields', async () => {
      const authUserId = new mongoose.Types.ObjectId().toString();
      const petId = new mongoose.Types.ObjectId().toString();
      const dewormId = new mongoose.Types.ObjectId().toString();
      const { handler, authorizer, dewormModel, petModel } = loadHandlerWithMocks({
        authUserId,
        petDoc: { _id: petId, userId: authUserId, ngoId: null },
      });
      dewormModel.findOneAndUpdate.mockReturnValueOnce({
        lean: jest.fn().mockResolvedValue({ _id: dewormId, petId, vaccineBrand: 'X' }),
      });

      const result = await handler(
        createEvent({
          method: 'PATCH',
          path: `/pet/medical/${petId}/deworming/${dewormId}`,
          resource: '/pet/medical/{petId}/deworming/{dewormId}',
          pathParameters: { petId, dewormId },
          body: JSON.stringify({ vaccineBrand: 'X' }),
          authorizer,
        }),
        createContext()
      );
      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(200);
      expect(dewormModel.countDocuments).not.toHaveBeenCalled();
      expect(petModel.findByIdAndUpdate).not.toHaveBeenCalled();
      expect(petModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    test('DELETE on deworming does not touch Pet summary fields', async () => {
      const authUserId = new mongoose.Types.ObjectId().toString();
      const petId = new mongoose.Types.ObjectId().toString();
      const dewormId = new mongoose.Types.ObjectId().toString();
      const { handler, authorizer, dewormModel, petModel } = loadHandlerWithMocks({
        authUserId,
        petDoc: { _id: petId, userId: authUserId, ngoId: null },
      });
      dewormModel.deleteOne.mockResolvedValueOnce({ deletedCount: 1 });

      const result = await handler(
        createEvent({
          method: 'DELETE',
          path: `/pet/medical/${petId}/deworming/${dewormId}`,
          resource: '/pet/medical/{petId}/deworming/{dewormId}',
          pathParameters: { petId, dewormId },
          authorizer,
        }),
        createContext()
      );
      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(200);
      expect(dewormModel.countDocuments).not.toHaveBeenCalled();
      expect(petModel.findByIdAndUpdate).not.toHaveBeenCalled();
      expect(petModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    test('PATCH on blood-test does not touch Pet summary fields', async () => {
      const authUserId = new mongoose.Types.ObjectId().toString();
      const petId = new mongoose.Types.ObjectId().toString();
      const bloodTestId = new mongoose.Types.ObjectId().toString();
      const { handler, authorizer, bloodTestModel, petModel } = loadHandlerWithMocks({
        authUserId,
        petDoc: { _id: petId, userId: authUserId, ngoId: null },
      });
      bloodTestModel.findOneAndUpdate.mockReturnValueOnce({
        lean: jest.fn().mockResolvedValue({ _id: bloodTestId, petId, heartworm: 'negative' }),
      });

      const result = await handler(
        createEvent({
          method: 'PATCH',
          path: `/pet/medical/${petId}/blood-test/${bloodTestId}`,
          resource: '/pet/medical/{petId}/blood-test/{bloodTestId}',
          pathParameters: { petId, bloodTestId },
          body: JSON.stringify({ heartworm: 'negative' }),
          authorizer,
        }),
        createContext()
      );
      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(200);
      expect(bloodTestModel.countDocuments).not.toHaveBeenCalled();
      expect(petModel.findByIdAndUpdate).not.toHaveBeenCalled();
      expect(petModel.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe('Rate limiting', () => {
    test('POST create returns 429 with retry-after when over limit', async () => {
      const authUserId = new mongoose.Types.ObjectId().toString();
      const petId = new mongoose.Types.ObjectId().toString();
      const { handler, authorizer, medicalModel } = loadHandlerWithMocks({
        authUserId,
        petDoc: { _id: petId, userId: authUserId, ngoId: null },
        rateLimitEntry: {
          count: 999,
          expireAt: new Date(Date.now() + 30_000),
          windowStart: new Date(),
        },
      });
      const result = await handler(
        createEvent({
          method: 'POST',
          path: `/pet/medical/${petId}/general`,
          resource: '/pet/medical/{petId}/general',
          pathParameters: { petId },
          body: JSON.stringify({ medicalPlace: 'Clinic A' }),
          authorizer,
        }),
        createContext()
      );
      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(429);
      expect(parsed.body.errorKey).toBe('common.rateLimited');
      expect(result.headers['retry-after']).toBeDefined();
      // Rate limit must short-circuit before the record is created.
      expect(medicalModel.create).not.toHaveBeenCalled();
    });

    test('PATCH update returns 429 when over limit', async () => {
      const authUserId = new mongoose.Types.ObjectId().toString();
      const petId = new mongoose.Types.ObjectId().toString();
      const medicalId = new mongoose.Types.ObjectId().toString();
      const { handler, authorizer, medicalModel } = loadHandlerWithMocks({
        authUserId,
        petDoc: { _id: petId, userId: authUserId, ngoId: null },
        rateLimitEntry: {
          count: 999,
          expireAt: new Date(Date.now() + 30_000),
          windowStart: new Date(),
        },
      });
      const result = await handler(
        createEvent({
          method: 'PATCH',
          path: `/pet/medical/${petId}/general/${medicalId}`,
          resource: '/pet/medical/{petId}/general/{medicalId}',
          pathParameters: { petId, medicalId },
          body: JSON.stringify({ medicalPlace: 'X' }),
          authorizer,
        }),
        createContext()
      );
      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(429);
      expect(parsed.body.errorKey).toBe('common.rateLimited');
      expect(medicalModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    test('DELETE returns 429 when over limit', async () => {
      const authUserId = new mongoose.Types.ObjectId().toString();
      const petId = new mongoose.Types.ObjectId().toString();
      const medicalId = new mongoose.Types.ObjectId().toString();
      const { handler, authorizer, medicalModel } = loadHandlerWithMocks({
        authUserId,
        petDoc: { _id: petId, userId: authUserId, ngoId: null },
        rateLimitEntry: {
          count: 999,
          expireAt: new Date(Date.now() + 30_000),
          windowStart: new Date(),
        },
      });
      const result = await handler(
        createEvent({
          method: 'DELETE',
          path: `/pet/medical/${petId}/general/${medicalId}`,
          resource: '/pet/medical/{petId}/general/{medicalId}',
          pathParameters: { petId, medicalId },
          authorizer,
        }),
        createContext()
      );
      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(429);
      expect(parsed.body.errorKey).toBe('common.rateLimited');
      expect(medicalModel.deleteOne).not.toHaveBeenCalled();
    });
  });
});
