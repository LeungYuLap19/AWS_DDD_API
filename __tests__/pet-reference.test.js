/**
 * pet-reference Lambda — handler-level integration tests (Tier 2).
 *
 * Exercises the real exported `handler` (createApiGatewayHandler -> createRouter)
 * against the public reference routes. MongoDB is mocked; no real DB.
 *
 * Routes under test:
 *   GET /pet/reference/breed/{animalType}?lang={lang}
 *   GET /pet/reference/deworm
 *
 * Run:  npm test -- __tests__/pet-reference.test.js --runInBand
 * Pre-req: npm run build:ts  (builds dist/)
 */

'use strict';

const path = require('path');
const mongoose = require('mongoose');

const handlerModulePath = path.resolve(__dirname, '../dist/functions/pet-reference/index.js');
const sharedRuntimeModulePath = path.resolve(
  __dirname,
  '../dist/layers/shared-runtime/nodejs/node_modules/@aws-ddd-api/shared/index.js'
);

function createContext() {
  return {
    awsRequestId: 'req-pet-reference-handler',
    callbackWaitsForEmptyEventLoop: true,
  };
}

function createEvent({
  method = 'GET',
  path: reqPath,
  resource,
  body = null,
  headers = {},
  pathParameters = null,
  queryStringParameters = null,
} = {}) {
  return {
    httpMethod: method,
    path: reqPath,
    resource: resource || reqPath,
    headers,
    body,
    pathParameters,
    queryStringParameters,
    multiValueQueryStringParameters: null,
    multiValueHeaders: {},
    stageVariables: null,
    requestContext: {
      requestId: 'req-pet-reference-handler',
      identity: { sourceIp: '198.51.100.20' },
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
  delete process.env.AWS_SAM_LOCAL;
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

function loadHandlerWithMocks({
  animalDocs = [],
  anthelminticDocs = [],
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

  const animalModel = {
    find: jest.fn(() => createLeanResult(animalDocs)),
  };

  const anthelminticModel = {
    find: jest.fn(() => createLeanResult(anthelminticDocs)),
  };

  const rateLimitModel = {
    findOne: jest.fn(() => ({
      lean: jest.fn().mockResolvedValue(null),
    })),
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
      if (name === 'Animal') return animalModel;
      if (name === 'Anthelmintic') return anthelminticModel;
      if (name === 'RateLimit' || name === 'MongoRateLimit') return rateLimitModel;
      throw new Error(`Unexpected model "${name}"`);
    }),
  };

  jest.doMock('mongoose', () => ({ __esModule: true, default: mongooseMock }));
  jest.doMock('@aws-ddd-api/shared', () => require(sharedRuntimeModulePath), { virtual: true });

  const { handler } = require(handlerModulePath);
  return { handler, animalModel, anthelminticModel, rateLimitModel };
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

describe('pet-reference handler Tier 2 integration', () => {
  describe('Router proofs', () => {
    test('returns 404 for unknown route', async () => {
      const { handler } = loadHandlerWithMocks();
      const result = await handler(
        createEvent({
          method: 'GET',
          path: '/pet/reference/unknown',
          resource: '/pet/reference/unknown',
        }),
        createContext()
      );
      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(404);
      expect(parsed.body.errorKey).toBe('common.routeNotFound');
    });
  });

  describe('Breed reference', () => {
    test('returns the nested breed payload for the requested animalType/lang', async () => {
      const { handler, animalModel } = loadHandlerWithMocks({
        animalDocs: [
          {
            breeds: {
              dog: {
                zh: [
                  { name: '柴犬' },
                  { name: '貴婦狗' },
                ],
              },
            },
            _internal: 'should not matter',
          },
        ],
      });

      const result = await handler(
        createEvent({
          method: 'GET',
          path: '/pet/reference/breed/dog',
          resource: '/pet/reference/breed/{animalType}',
          pathParameters: { animalType: 'dog' },
          queryStringParameters: { lang: 'zh' },
        }),
        createContext()
      );
      const parsed = parseResponse(result);

      expect(parsed.statusCode).toBe(200);
      expect(parsed.body.message).toBe('成功取得資料');
      expect(parsed.body.data).toEqual([{ name: '柴犬' }, { name: '貴婦狗' }]);
      expect(animalModel.find).toHaveBeenCalledTimes(1);
    });

    test('returns the nested breed payload for cn when present', async () => {
      const { handler, animalModel } = loadHandlerWithMocks({
        animalDocs: [
          {
            breeds: {
              dog: {
                cn: [
                  { name: '柴犬简体' },
                ],
              },
            },
          },
        ],
      });

      const result = await handler(
        createEvent({
          method: 'GET',
          path: '/pet/reference/breed/dog',
          resource: '/pet/reference/breed/{animalType}',
          pathParameters: { animalType: 'dog' },
          queryStringParameters: { lang: 'cn' },
        }),
        createContext()
      );
      const parsed = parseResponse(result);

      expect(parsed.statusCode).toBe(200);
      expect(parsed.body.message).toBe('Retrieved successfully');
      expect(parsed.body.data).toEqual([{ name: '柴犬简体' }]);
      expect(animalModel.find).toHaveBeenCalledTimes(1);
    });

    test('returns 400 when animalType is blank', async () => {
      const { handler, animalModel } = loadHandlerWithMocks();
      const result = await handler(
        createEvent({
          method: 'GET',
          path: '/pet/reference/breed/%20%20',
          resource: '/pet/reference/breed/{animalType}',
          pathParameters: { animalType: '   ' },
          queryStringParameters: { lang: 'zh' },
        }),
        createContext()
      );
      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(400);
      expect(parsed.body.errorKey).toBe('petReference.errors.invalidAnimalType');
      expect(animalModel.find).not.toHaveBeenCalled();
    });

    test('returns 400 when animalType is URL-encoded whitespace', async () => {
      const { handler, animalModel } = loadHandlerWithMocks();
      const result = await handler(
        createEvent({
          method: 'GET',
          path: '/pet/reference/breed/%20%20',
          resource: '/pet/reference/breed/{animalType}',
          pathParameters: { animalType: '%20%20' },
          queryStringParameters: { lang: 'zh' },
        }),
        createContext()
      );
      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(400);
      expect(parsed.body.errorKey).toBe('petReference.errors.invalidAnimalType');
      expect(animalModel.find).not.toHaveBeenCalled();
    });

    test('returns 400 when lang is missing or malformed', async () => {
      const { handler, animalModel } = loadHandlerWithMocks();
      const result = await handler(
        createEvent({
          method: 'GET',
          path: '/pet/reference/breed/dog',
          resource: '/pet/reference/breed/{animalType}',
          pathParameters: { animalType: 'dog' },
          queryStringParameters: {},
        }),
        createContext()
      );
      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(400);
      expect(parsed.body.errorKey).toBe('petReference.errors.invalidLang');
      expect(animalModel.find).not.toHaveBeenCalled();
    });

    test('returns 404 when the breed payload is missing', async () => {
      const { handler } = loadHandlerWithMocks({
        animalDocs: [
          {
            breeds: {
              dog: {
                zh: [],
              },
            },
          },
        ],
      });

      const result = await handler(
        createEvent({
          method: 'GET',
          path: '/pet/reference/breed/dog',
          resource: '/pet/reference/breed/{animalType}',
          pathParameters: { animalType: 'dog' },
          queryStringParameters: { lang: 'zh' },
        }),
        createContext()
      );
      const parsed = parseResponse(result);

      expect(parsed.statusCode).toBe(404);
      expect(parsed.body.errorKey).toBe('petReference.errors.breedListNotFound');
    });

    test('returns 429 when over per-IP rate limit', async () => {
      const { handler, animalModel } = loadHandlerWithMocks({
        rateLimitEntry: {
          count: 999,
          expireAt: new Date(Date.now() + 30_000),
          windowStart: new Date(),
        },
      });
      const result = await handler(
        createEvent({
          method: 'GET',
          path: '/pet/reference/breed/dog',
          resource: '/pet/reference/breed/{animalType}',
          pathParameters: { animalType: 'dog' },
          queryStringParameters: { lang: 'zh' },
        }),
        createContext()
      );
      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(429);
      expect(parsed.body.errorKey).toBe('common.rateLimited');
      expect(animalModel.find).not.toHaveBeenCalled();
    });
  });

  describe('Deworm reference', () => {
    test('returns projected brandName list without auth', async () => {
      const { handler, anthelminticModel } = loadHandlerWithMocks();
      const brandId = new mongoose.Types.ObjectId();
      anthelminticModel.find.mockReturnValueOnce(
        createLeanResult([{ _id: brandId, brandName: 'NexGard', _otherInternal: 'leak?' }])
      );

      const result = await handler(
        createEvent({
          method: 'GET',
          path: '/pet/reference/deworm',
          resource: '/pet/reference/deworm',
        }),
        createContext()
      );
      const parsed = parseResponse(result);

      expect(parsed.statusCode).toBe(200);
      expect(parsed.body.message).toBe('Retrieved successfully');
      expect(parsed.body.data).toEqual([
        { _id: brandId.toString(), brandName: 'NexGard' },
      ]);
      expect(parsed.body.data[0]).not.toHaveProperty('_otherInternal');
      expect(anthelminticModel.find).toHaveBeenCalledTimes(1);
    });

    test('returns 429 when over per-IP rate limit', async () => {
      const { handler, anthelminticModel } = loadHandlerWithMocks({
        rateLimitEntry: {
          count: 999,
          expireAt: new Date(Date.now() + 30_000),
          windowStart: new Date(),
        },
      });
      const result = await handler(
        createEvent({
          method: 'GET',
          path: '/pet/reference/deworm',
          resource: '/pet/reference/deworm',
        }),
        createContext()
      );
      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(429);
      expect(parsed.body.errorKey).toBe('common.rateLimited');
      expect(anthelminticModel.find).not.toHaveBeenCalled();
    });

    test('returns 200 with empty data when the reference collection is empty', async () => {
      const { handler } = loadHandlerWithMocks({ anthelminticDocs: [] });
      const result = await handler(
        createEvent({
          method: 'GET',
          path: '/pet/reference/deworm',
          resource: '/pet/reference/deworm',
        }),
        createContext()
      );
      const parsed = parseResponse(result);
      expect(parsed.statusCode).toBe(200);
      expect(parsed.body.data).toEqual([]);
    });
  });
});
