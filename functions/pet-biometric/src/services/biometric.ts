import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import {
  parseMultipartBody,
  parseObjectIdParam,
} from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import env from '../config/env';
import { connectToMongoDB } from '../config/db';
import { loadAuthorizedPet, requireAuthContext } from '../utils/auth';
import {
  normalizeRegisterMultipartBody,
  normalizeVerifyMultipartBody,
} from '../utils/multipart';
import { applyRateLimit } from '../utils/rateLimit';
import { response } from '../utils/response';
import { uploadImageFile } from '../utils/upload';
import {
  registerBiometricSchema,
  verifyBiometricSchema,
} from '../zodSchema/biometricSchemas';

const lambdaClient = new LambdaClient({});

type MlInvokeOperation = 'register' | 'verify';
type PetType = 'cat' | 'dog';
type EmbeddingCandidate = {
  angle: 'front-face' | 'high-face' | 'left-face' | 'low-face' | 'right-face';
  embedding: number[];
};
const ALLOWED_ANGLES = new Set<EmbeddingCandidate['angle']>([
  'front-face',
  'high-face',
  'left-face',
  'low-face',
  'right-face',
]);

type MlRegisterPayload = {
  status?: string;
  angle?: string | null;
  score?: number | null;
  counts?: Record<string, number>;
  can_finish?: boolean;
  front_image?: string | null;
  embedding?: number[];
  petId?: string;
  petType?: string;
  image?: { bucket?: string; key?: string };
};

type MlVerifyPayload = {
  status?: string;
  similarity?: number | null;
  angle?: string | null;
  threshold?: number;
  petId?: string;
  petType?: string;
  image?: { bucket?: string; key?: string };
  candidateCount?: number;
};

type MlSuccessEnvelope<T = unknown> = {
  ok: true;
  op: MlInvokeOperation;
  data: T;
};

type MlErrorEnvelope = {
  ok: false;
  statusCode?: number;
  errorKey?: string;
  message?: string;
};

type UploadedImageRef = {
  key: string;
  url: string;
};

async function invokeMlInference<T>(
  params: {
    op: MlInvokeOperation;
    petId: string;
    body: Record<string, unknown>;
    requestId?: string | null;
  }
): Promise<T> {
  const functionName = env.ML_INFERENCE_FUNCTION_NAME;
  const payload = {
    op: params.op,
    petId: params.petId,
    body: params.body,
    requestId: params.requestId ?? undefined,
  };

  const result = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'RequestResponse',
      Payload: Buffer.from(JSON.stringify(payload)),
    })
  );

  if (result.FunctionError) {
    throw new Error(`ml-inference invoke failed: ${result.FunctionError}`);
  }

  const payloadText = result.Payload ? Buffer.from(result.Payload).toString('utf8') : '';
  if (!payloadText) return {} as T;

  let decoded: unknown;
  try {
    decoded = JSON.parse(payloadText);
  } catch {
    return { raw: payloadText } as T;
  }

  if (typeof decoded === 'object' && decoded !== null && 'ok' in decoded) {
    const maybeErr = decoded as MlErrorEnvelope;
    if (maybeErr.ok === false) {
      throw {
        statusCode: typeof maybeErr.statusCode === 'number' ? maybeErr.statusCode : 502,
        errorKey:
          typeof maybeErr.errorKey === 'string'
            ? maybeErr.errorKey
            : 'common.serviceUnavailable',
      };
    }

    const maybeOk = decoded as MlSuccessEnvelope<T>;
    if (maybeOk.ok === true) {
      return maybeOk.data;
    }
  }

  return decoded as T;
}

function getPetId(ctx: RouteContext): string | APIGatewayProxyResult {
  const petIdResult = parseObjectIdParam(ctx.event.pathParameters?.petId);
  if (!petIdResult.ok) {
    return response.errorResponse(petIdResult.statusCode, petIdResult.errorKey, ctx.event);
  }

  return petIdResult.data;
}

function buildFolder(petId: string, purpose: 'registrations' | 'verifications'): string {
  const base = purpose === 'registrations' ? 'face-id/registrations' : 'face-id/verifications';
  return `user-uploads/pets/${petId}/${base}`;
}

function buildS3KeyFromUrl(url: string): string {
  const base = `${env.AWS_BUCKET_BASE_URL}/`;
  if (!url.startsWith(base)) {
    throw new Error('Uploaded image URL does not match AWS_BUCKET_BASE_URL');
  }

  return url.slice(base.length);
}

async function uploadImageOrError(
  op: MlInvokeOperation,
  file: { content: Buffer; filename: string },
  petId: string,
  ctx: RouteContext
): Promise<UploadedImageRef | APIGatewayProxyResult> {
  const purpose = op === 'register' ? 'registrations' : 'verifications';

  try {
    const url = await uploadImageFile(
      { buffer: file.content, originalname: file.filename },
      buildFolder(petId, purpose),
      'user'
    );

    return {
      url,
      key: buildS3KeyFromUrl(url),
    };
  } catch (error: unknown) {
    const code = (error as { code?: string }).code;
    if (code === 'INVALID_FILE_TYPE') {
      return response.errorResponse(400, 'petBiometric.errors.invalidFileType', ctx.event);
    }
    if (code === 'FILE_TOO_LARGE') {
      return response.errorResponse(413, 'petBiometric.errors.fileTooLarge', ctx.event);
    }
    throw error;
  }
}

function normalizeRegisterOutcome(payload: MlRegisterPayload) {
  return {
    status: payload.status ?? 'unknown',
    angle: payload.angle ?? null,
    score: payload.score ?? null,
    counts: payload.counts ?? {},
    can_finish: payload.can_finish ?? false,
    front_image: payload.front_image ?? null,
  };
}

function isAcceptedRegisterStatus(status: string | undefined): boolean {
  return status === 'accepted' || status === 'angle_full';
}

function extractImageFile(
  files: Array<{ fieldname?: string; content?: Buffer; filename?: string }>
): { content: Buffer; filename: string } | null {
  const imageFiles = files.filter((entry) => entry?.fieldname === 'image' && entry?.content);
  if (imageFiles.length !== 1) return null;
  const file = imageFiles[0];
  if (!file?.content) return null;
  return {
    content: file.content,
    filename: file.filename ?? 'upload',
  };
}

function extractRegisterFiles(
  files: Array<{ fieldname?: string; content?: Buffer; filename?: string }>
): Array<{ content: Buffer; filename: string }> {
  return files
    .filter((entry) => entry?.fieldname === 'image' && entry?.content)
    .map((entry) => ({
      content: entry.content as Buffer,
      filename: entry.filename ?? 'upload',
    }));
}

async function upsertBiometricDocument(params: {
  petId: string;
  userId: string;
  petType: PetType;
  imageKey: string;
  angle: string;
  embedding: number[];
}) {
  const PetBiometric = mongoose.model('PetBiometric');
  await PetBiometric.updateOne(
    { petId: params.petId },
    {
      $setOnInsert: {
        petId: params.petId,
        userId: params.userId,
        petType: params.petType,
      },
      $push: {
        imageKeys: params.imageKey,
        embeddings: {
          angle: params.angle,
          embedding: params.embedding,
        },
      },
    },
    { upsert: true }
  );
}

async function loadCandidates(petId: string): Promise<EmbeddingCandidate[]> {
  const PetBiometric = mongoose.model('PetBiometric');
  const doc = await PetBiometric.findOne({ petId })
    .select('embeddings')
    .lean() as { embeddings?: Array<{ angle?: string; embedding?: number[] }> } | null;

  if (!doc?.embeddings?.length) return [];

  return doc.embeddings
    .filter((entry): entry is { angle: EmbeddingCandidate['angle']; embedding: number[] } =>
      typeof entry?.angle === 'string' &&
      ALLOWED_ANGLES.has(entry.angle as EmbeddingCandidate['angle']) &&
      Array.isArray(entry.embedding) &&
      entry.embedding.length > 0
    )
    .map((entry) => ({
      angle: entry.angle,
      embedding: entry.embedding,
    }));
}

async function loadBiometricDocument(petId: string) {
  const PetBiometric = mongoose.model('PetBiometric');
  return PetBiometric.findOne({ petId })
    .select('petId userId petType imageKeys embeddings createdAt')
    .lean() as Promise<{
      petId?: string;
      userId?: string;
      petType?: string;
      imageKeys?: string[];
      embeddings?: Array<{ angle?: string; embedding?: number[] }>;
      createdAt?: Date | string;
    } | null>;
}

function ensurePetTypeConsistency(storedPetType: unknown, requestedPetType: PetType) {
  if (storedPetType != null && String(storedPetType) !== requestedPetType) {
    return false;
  }

  return true;
}

export async function handleGetBiometric(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const auth = requireAuthContext(ctx.event);
  const petId = getPetId(ctx);
  if (typeof petId !== 'string') return petId;

  await connectToMongoDB();
  await loadAuthorizedPet(ctx.event, petId);

  const doc = await loadBiometricDocument(petId);
  const hasFaceId = Boolean(doc?.embeddings?.length);

  return response.successResponse(200, ctx.event, {
    message: 'success.retrieved',
    data: {
      petId,
      userId: auth.userId,
      hasFaceId,
      biometric: doc
        ? {
            petId: doc.petId,
            userId: doc.userId,
            petType: doc.petType,
            createdAt: doc.createdAt ?? null,
            imageKeys: doc.imageKeys ?? [],
            embeddings: doc.embeddings ?? [],
          }
        : null,
    },
  });
}

export async function handleDeleteBiometric(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);
  const petId = getPetId(ctx);
  if (typeof petId !== 'string') return petId;

  await connectToMongoDB();

  const rateLimitResult = await applyRateLimit({
    action: 'pet-biometric.delete',
    event: ctx.event,
    identifier: authContext.userId,
    policies: [
      { scope: 'ip', limit: 30, windowSeconds: 60 },
      { scope: 'identifier', limit: 15, windowSeconds: 60 },
      { scope: 'ip+identifier', limit: 10, windowSeconds: 60 },
    ],
  });
  if (rateLimitResult) return rateLimitResult;

  await loadAuthorizedPet(ctx.event, petId);

  const PetBiometric = mongoose.model('PetBiometric');
  await PetBiometric.deleteOne({ petId });

  return response.successResponse(200, ctx.event, {
    message: 'success.deleted',
    data: {
      petId,
      deleted: true,
    },
  });
}

export async function handleRegisterBiometric(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const auth = requireAuthContext(ctx.event);
  const petId = getPetId(ctx);
  if (typeof petId !== 'string') return petId;

  const multiResult = await parseMultipartBody(ctx.event, registerBiometricSchema, {
    normalize: normalizeRegisterMultipartBody,
    fallbackErrorKey: 'common.validationFailed',
  });
  if (!multiResult.ok) {
    return response.errorResponse(multiResult.statusCode, multiResult.errorKey, ctx.event);
  }

  const files = extractRegisterFiles(multiResult.files);
  if (files.length === 0) {
    return response.errorResponse(400, 'petBiometric.errors.noFilesUploaded', ctx.event);
  }

  await connectToMongoDB();

  const rateLimitResult = await applyRateLimit({
    action: 'pet-biometric.register',
    event: ctx.event,
    identifier: auth.userId,
    policies: [
      { scope: 'ip', limit: 60, windowSeconds: 300 },
      { scope: 'identifier', limit: 30, windowSeconds: 300 },
      { scope: 'ip+identifier', limit: 20, windowSeconds: 300 },
    ],
  });
  if (rateLimitResult) return rateLimitResult;

  await loadAuthorizedPet(ctx.event, petId);

  const existingDoc = await loadBiometricDocument(petId);
  if (!ensurePetTypeConsistency(existingDoc?.petType, multiResult.data.petType)) {
    return response.errorResponse(400, 'petBiometric.errors.petTypeMismatch', ctx.event);
  }

  const accepted: Array<Record<string, unknown>> = [];
  const rejected: Array<Record<string, unknown>> = [];
  const acceptedForPersistence: Array<{
    imageKey: string;
    angle: string;
    embedding: number[];
  }> = [];

  for (const file of files) {
    const uploaded = await uploadImageOrError('register', file, petId, ctx);
    if ('statusCode' in uploaded) return uploaded;

    let mlResult: MlRegisterPayload;
    try {
      mlResult = await invokeMlInference<MlRegisterPayload>({
        op: 'register',
        petId,
        body: {
          petType: multiResult.data.petType,
          image: {
            bucket: env.AWS_BUCKET_NAME,
            key: uploaded.key,
          },
        },
        requestId: ctx.event.requestContext?.requestId ?? null,
      });
    } catch (error) {
      const statusCode = (error as { statusCode?: unknown })?.statusCode;
      const errorKey = (error as { errorKey?: unknown })?.errorKey;
      if (typeof statusCode === 'number' && typeof errorKey === 'string') {
        return response.errorResponse(statusCode, errorKey, ctx.event);
      }
      throw error;
    }

    const normalized = normalizeRegisterOutcome(mlResult);
    if (!isAcceptedRegisterStatus(normalized.status)) {
      rejected.push({
        imageKey: uploaded.key,
        ...normalized,
      });
      continue;
    }

    const angle = typeof mlResult.angle === 'string' ? mlResult.angle : null;
    const embedding = Array.isArray(mlResult.embedding) ? mlResult.embedding : [];
    if (!angle || embedding.length === 0) {
      return response.errorResponse(502, 'common.serviceUnavailable', ctx.event, {
        message: 'common.serviceUnavailable',
      });
    }

    acceptedForPersistence.push({
      imageKey: uploaded.key,
      angle,
      embedding,
    });

    accepted.push({
      imageKey: uploaded.key,
      embedding,
      ...normalized,
    });
  }

  if (acceptedForPersistence.length === 0) {
    return response.errorResponse(400, 'petBiometric.errors.noAcceptedImages', ctx.event);
  }

  for (const item of acceptedForPersistence) {
    await upsertBiometricDocument({
      petId,
      userId: auth.userId,
      petType: multiResult.data.petType,
      imageKey: item.imageKey,
      angle: item.angle,
      embedding: item.embedding,
    });
  }

  return response.successResponse(200, ctx.event, {
    message: 'success.retrieved',
    data: {
      petId,
      petType: multiResult.data.petType,
      accepted,
      rejected,
    },
  });
}

export async function handleVerifyBiometric(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const auth = requireAuthContext(ctx.event);
  const petId = getPetId(ctx);
  if (typeof petId !== 'string') return petId;

  const multiResult = await parseMultipartBody(ctx.event, verifyBiometricSchema, {
    normalize: normalizeVerifyMultipartBody,
    fallbackErrorKey: 'common.validationFailed',
  });
  if (!multiResult.ok) {
    return response.errorResponse(multiResult.statusCode, multiResult.errorKey, ctx.event);
  }

  const file = extractImageFile(multiResult.files);
  if (!file) {
    const errorKey =
      multiResult.files.filter((entry) => entry?.fieldname === 'image' && entry?.content).length > 1
        ? 'petBiometric.errors.tooManyFiles'
        : 'petBiometric.errors.noFilesUploaded';
    return response.errorResponse(400, errorKey, ctx.event);
  }

  await connectToMongoDB();

  const rateLimitResult = await applyRateLimit({
    action: 'pet-biometric.verify',
    event: ctx.event,
    identifier: auth.userId,
    policies: [
      { scope: 'ip', limit: 90, windowSeconds: 300 },
      { scope: 'identifier', limit: 45, windowSeconds: 300 },
      { scope: 'ip+identifier', limit: 30, windowSeconds: 300 },
    ],
  });
  if (rateLimitResult) return rateLimitResult;

  await loadAuthorizedPet(ctx.event, petId);

  const existingDoc = await loadBiometricDocument(petId);
  if (!ensurePetTypeConsistency(existingDoc?.petType, multiResult.data.petType)) {
    return response.errorResponse(400, 'petBiometric.errors.petTypeMismatch', ctx.event);
  }

  const candidates = await loadCandidates(petId);
  const uploaded = await uploadImageOrError('verify', file, petId, ctx);
  if ('statusCode' in uploaded) return uploaded;

  let mlResult: MlVerifyPayload;
  try {
    mlResult = await invokeMlInference<MlVerifyPayload>({
      op: 'verify',
      petId,
      body: {
        petType: multiResult.data.petType,
        image: {
          bucket: env.AWS_BUCKET_NAME,
          key: uploaded.key,
        },
        candidates,
        ...(multiResult.data.threshold !== undefined
          ? { threshold: multiResult.data.threshold }
          : {}),
      },
      requestId: ctx.event.requestContext?.requestId ?? null,
    });
  } catch (error) {
    const statusCode = (error as { statusCode?: unknown })?.statusCode;
    const errorKey = (error as { errorKey?: unknown })?.errorKey;
    if (typeof statusCode === 'number' && typeof errorKey === 'string') {
      return response.errorResponse(statusCode, errorKey, ctx.event);
    }
    throw error;
  }

  return response.successResponse(200, ctx.event, {
    message: 'success.retrieved',
    data: {
      petId,
      petType: multiResult.data.petType,
      imageKey: uploaded.key,
      candidatesCount: candidates.length,
      result: mlResult,
    },
  });
}
