import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { parseMultipartBody } from '@aws-ddd-api/shared/validation/zod';
import type { RouteContext } from '../../../../types/lambda';
import env from '../config/env';
import { connectToMongoDB } from '../config/db';
import { loadAuthorizedPet, requireAuthContext } from '../utils/auth';
import {
  cleanupUploadedImage,
  extractImageFile,
  extractRegisterFiles,
  getEnrollmentProgress,
  getPetId,
  isAcceptedRegisterStatus,
  isPetTypeConsistent,
  loadBiometricDocument,
  loadCandidates,
  type PetType,
  upsertBiometricDocument,
  uploadImageOrError,
} from '../utils/biometric';
import {
  invokeMlInference,
  type MlRegisterPayload,
  type MlVerifyPayload,
} from '../utils/mlInference';
import {
  normalizeRegisterMultipartBody,
  normalizeVerifyMultipartBody,
} from '../utils/multipart';
import { applyRateLimit } from '../utils/rateLimit';
import { response } from '../utils/response';
import {
  registerBiometricSchema,
  verifyBiometricSchema,
} from '../zodSchema/biometricSchemas';

const VERIFY_SUCCESS_STATUSES = new Set(['matched', 'no_match']);

/**
 * Returns the authenticated caller's biometric enrollment summary for one pet
 * after validating ownership against the pet record in MongoDB.
 *
 * This endpoint is read-only and does not invoke `ml-inference`.
 */
export async function handleGetBiometric(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const auth = requireAuthContext(ctx.event);
  const petId = getPetId(ctx);
  if (typeof petId !== 'string') return petId;

  await connectToMongoDB();
  await loadAuthorizedPet(ctx.event, petId);

  const doc = await loadBiometricDocument(petId);
  const progress = getEnrollmentProgress(doc);
  const hasFaceId = progress.canFinish;

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

/**
 * Deletes the stored Face ID document for one owned pet.
 *
 * The route is destructive but DB-only: it rate-limits the caller, enforces
 * pet ownership, and removes the `pet_biometrics` document without invoking
 * `ml-inference`.
 */
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

/**
 * Registers one or more multipart-uploaded pet images for Face ID enrollment.
 *
 * The handler validates multipart form fields, uploads each image to S3,
 * invokes `ml-inference register` once per image, and persists only accepted
 * embeddings to MongoDB immediately after each accepted ML result before
 * returning the remaining public enrollment progress.
 */
export async function handleRegisterBiometric(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const auth = requireAuthContext(ctx.event);
  const petId = getPetId(ctx);
  if (typeof petId !== 'string') return petId;

  // 1. Parse the multipart request and validate the public register contract.
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

  // 2. Open the DB connection before rate-limit, ownership, and persistence work.
  await connectToMongoDB();

  // 3. Apply write-path throttling before any S3 or ML work starts.
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

  // 4. Verify the caller owns the pet and that the requested petType stays consistent.
  await loadAuthorizedPet(ctx.event, petId);

  const existingDoc = await loadBiometricDocument(petId);
  if (!isPetTypeConsistent(existingDoc?.petType, multiResult.data.petType as PetType)) {
    return response.errorResponse(400, 'petBiometric.errors.petTypeMismatch', ctx.event);
  }

  let persistedAcceptedCount = 0;

  for (const file of files) {
    // 5. Upload one registration image to S3 before invoking ML on that object.
    const uploaded = await uploadImageOrError('register', file, petId, ctx);
    if ('statusCode' in uploaded) return uploaded;

    let mlResult: MlRegisterPayload;
    try {
      // 6. Invoke the internal ML register operation with the uploaded S3 reference.
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
      await cleanupUploadedImage(uploaded.key, 'register.mlInvokeFailed');
      if (typeof statusCode === 'number' && typeof errorKey === 'string') {
        return response.errorResponse(statusCode, errorKey, ctx.event);
      }
      throw error;
    }

    const status = typeof mlResult.status === 'string' ? mlResult.status : 'unknown';
    if (!isAcceptedRegisterStatus(status)) {
      // 7. Reject non-persistable ML outcomes and clean up their transient S3 objects.
      await cleanupUploadedImage(uploaded.key, `register.${status}`);
      continue;
    }

    // 8. Guard the persistable branch: accepted ML results must include angle + embedding.
    const angle = typeof mlResult.angle === 'string' ? mlResult.angle : null;
    const embedding = Array.isArray(mlResult.embedding) ? mlResult.embedding : [];
    if (!angle || embedding.length === 0) {
      await cleanupUploadedImage(uploaded.key, 'register.invalidAcceptedPayload');
      return response.errorResponse(502, 'common.serviceUnavailable', ctx.event, {
        message: 'common.serviceUnavailable',
      });
    }

    // 9. Persist each accepted enrollment image immediately so earlier progress is not lost
    // if a later file in the same batch fails.
    await upsertBiometricDocument({
      imageKey: uploaded.key,
      petId,
      userId: auth.userId,
      petType: multiResult.data.petType,
      angle,
      embedding,
    });
    persistedAcceptedCount += 1;
  }

  // 10. If every uploaded image was rejected, fail the request without writing Mongo data.
  if (persistedAcceptedCount === 0) {
    return response.errorResponse(400, 'petBiometric.errors.noAcceptedImages', ctx.event);
  }

  // 11. Reload the persisted document and derive cumulative enrollment progress from Mongo.
  const persistedDoc = await loadBiometricDocument(petId);
  const progress = getEnrollmentProgress(persistedDoc);

  // 12. Return only the public progress fields required by the register contract.
  return response.successResponse(201, ctx.event, {
    message: 'success.created',
    data: progress,
  });
}

/**
 * Verifies one multipart-uploaded probe image against the stored embeddings for
 * an owned pet.
 *
 * The handler uploads the probe image to S3, loads Mongo-backed candidates by
 * `petId`, invokes `ml-inference verify`, and returns a stable verification
 * outcome without mutating the biometric record.
 */
export async function handleVerifyBiometric(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const auth = requireAuthContext(ctx.event);
  const petId = getPetId(ctx);
  if (typeof petId !== 'string') return petId;

  // 1. Parse the multipart request and validate the public verify contract.
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

  // 2. Open the DB connection before rate-limit, ownership, and candidate lookup work.
  await connectToMongoDB();

  // 3. Apply write-path throttling before S3 upload and ML verification work starts.
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

  // 4. Verify the caller owns the pet and that the requested petType stays consistent.
  await loadAuthorizedPet(ctx.event, petId);

  const existingDoc = await loadBiometricDocument(petId);
  if (!isPetTypeConsistent(existingDoc?.petType, multiResult.data.petType as PetType)) {
    return response.errorResponse(400, 'petBiometric.errors.petTypeMismatch', ctx.event);
  }

  // 5. Load stored candidate embeddings, then upload the probe image to S3 for ML access.
  const candidates = await loadCandidates(petId);
  const uploaded = await uploadImageOrError('verify', file, petId, ctx);
  if ('statusCode' in uploaded) return uploaded;

  let mlResult: MlVerifyPayload;
  try {
    // 6. Invoke the internal ML verify operation with the probe image and Mongo candidates.
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
  } finally {
    // 7. Verification probe images are transient, so always clean them up after ML returns.
    await cleanupUploadedImage(uploaded.key, 'verify.probe');
  }

  const status = typeof mlResult.status === 'string' ? mlResult.status : 'unknown';
  const similarity = typeof mlResult.similarity === 'number' ? mlResult.similarity : null;
  const angle = typeof mlResult.angle === 'string' ? mlResult.angle : null;
  const matched = status === 'matched';
  const completed = VERIFY_SUCCESS_STATUSES.has(status);

  // 8. Return a stable public verify result without transient S3 probe references.
  return response.successResponse(200, ctx.event, {
    message: 'success.completed',
    data: {
      matched,
      completed,
      status,
      similarity,
      angle,
    },
  });
}
