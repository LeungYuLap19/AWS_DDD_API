import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { logWarn } from '@aws-ddd-api/shared/logging/logger';
import { parseObjectIdParam } from '@aws-ddd-api/shared/validation/common';
import type { RouteContext } from '../../../../types/lambda';
import { response } from './response';
import { deleteImageFile, uploadImageFile } from './upload';
import type { MlInvokeOperation } from './mlInference';

/** Accepted pet types for the Face ID register/verify contract. */
export type PetType = 'cat' | 'dog';

/**
 * Candidate embedding item passed from `pet-biometric` to `ml-inference
 * verify`.
 */
export type EmbeddingCandidate = {
  angle: 'front-face' | 'high-face' | 'left-face' | 'low-face' | 'right-face';
  embedding: number[];
};

type UploadedImageRef = {
  key: string;
};

const ALLOWED_ANGLES = new Set<EmbeddingCandidate['angle']>([
  'front-face',
  'high-face',
  'left-face',
  'low-face',
  'right-face',
]);

const ENROLLMENT_PROGRESS_ANGLES = new Set<EmbeddingCandidate['angle']>([
  'front-face',
  'high-face',
  'low-face',
]);

const ENROLLMENT_COMPLETION_TARGET = 10;

/**
 * Parses and validates the biometric route `petId` path parameter, returning a
 * ready-made error response on failure.
 */
export function getPetId(ctx: RouteContext): string | APIGatewayProxyResult {
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

/**
 * Uploads one biometric image and maps canonical upload helper failures into
 * this lambda's response format.
 */
export async function uploadImageOrError(
  op: MlInvokeOperation,
  file: { content: Buffer; filename: string },
  petId: string,
  ctx: RouteContext
): Promise<UploadedImageRef | APIGatewayProxyResult> {
  const purpose = op === 'register' ? 'registrations' : 'verifications';

  try {
    const key = await uploadImageFile(
      { buffer: file.content, originalname: file.filename },
      buildFolder(petId, purpose)
    );

    return {
      key,
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

/**
 * Removes one uploaded Face ID image from S3 as best-effort cleanup.
 *
 * This is used for transient objects that should not remain in storage, such
 * as registration images rejected by ML or verification probe images.
 */
export async function cleanupUploadedImage(key: string, reason: string): Promise<void> {
  await deleteImageFile(key).catch((error) =>
    logWarn('Face ID S3 cleanup failed', {
      error,
      extra: { key, reason },
      scope: 'pet-biometric.utils.biometric',
    })
  );
}

/**
 * Returns true only for ML register statuses that should be persisted as valid
 * enrollment embeddings.
 */
export function isAcceptedRegisterStatus(status: string | undefined): boolean {
  return status === 'accepted' || status === 'angle_full';
}

/**
 * Extracts exactly one `image` multipart file for verify requests.
 */
export function extractImageFile(
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

/**
 * Extracts all `image` multipart files for register requests.
 */
export function extractRegisterFiles(
  files: Array<{ fieldname?: string; content?: Buffer; filename?: string }>
): Array<{ content: Buffer; filename: string }> {
  return files
    .filter((entry) => entry?.fieldname === 'image' && entry?.content)
    .map((entry) => ({
      content: entry.content as Buffer,
      filename: entry.filename ?? 'upload',
    }));
}

/**
 * Upserts the biometric document for one pet by appending the accepted image
 * key and embedding returned by ML inference.
 */
export async function upsertBiometricDocument(params: {
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

/**
 * Loads all persisted Face ID embeddings for one pet and filters them down to
 * the allowed angle set expected by `ml-inference verify`.
 */
export async function loadCandidates(petId: string): Promise<EmbeddingCandidate[]> {
  const PetBiometric = mongoose.model('PetBiometric');
  const doc = (await PetBiometric.findOne({ petId })
    .select('embeddings')
    .lean()) as { embeddings?: Array<{ angle?: string; embedding?: number[] }> } | null;

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

/**
 * Loads the current biometric document for one pet, including stored image
 * keys and embeddings.
 */
export async function loadBiometricDocument(petId: string) {
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

/**
 * Derives public enrollment progress from the persisted biometric document.
 *
 * Only `front-face`, `high-face`, and `low-face` embeddings count toward the
 * current completion threshold of 10 accepted enrollment images.
 */
export function getEnrollmentProgress(doc: {
  embeddings?: Array<{ angle?: string; embedding?: number[] }>;
} | null | undefined): {
  remaining: number;
  canFinish: boolean;
} {
  const acceptedTotal = (doc?.embeddings ?? []).filter(
    (entry): entry is { angle: EmbeddingCandidate['angle']; embedding: number[] } =>
      typeof entry?.angle === 'string' &&
      ENROLLMENT_PROGRESS_ANGLES.has(entry.angle as EmbeddingCandidate['angle']) &&
      Array.isArray(entry.embedding) &&
      entry.embedding.length > 0
  ).length;

  return {
    remaining: Math.max(0, ENROLLMENT_COMPLETION_TARGET - acceptedTotal),
    canFinish: acceptedTotal >= ENROLLMENT_COMPLETION_TARGET,
  };
}

/**
 * Returns whether the requested pet type matches the already-persisted
 * biometric record, if one exists.
 */
export function isPetTypeConsistent(storedPetType: unknown, requestedPetType: PetType): boolean {
  if (storedPetType != null && String(storedPetType) !== requestedPetType) {
    return false;
  }

  return true;
}
