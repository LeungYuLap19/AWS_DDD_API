import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { type AuthContext, HttpError } from '@aws-ddd-api/shared/auth/context';
import type { RouteContext } from '../../../../types/lambda';
import { response } from './response';
import type { SourcePatchBody } from '../zodSchema/sourceSchema';

type AuthorizedPet = {
  _id: unknown;
  userId?: unknown;
  ngoId?: unknown;
};

/** Persisted pet-source record shape returned from Mongo for sanitization/update flows. */
export type PetSourceRecord = {
  _id: unknown;
  petId?: unknown;
  placeofOrigin?: string | null;
  channel?: string | null;
  rescueCategory?: string[];
  causeOfInjury?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
  toObject?: () => Record<string, unknown>;
};

/** Minimal duplicate-key error contract read from Mongo write failures. */
export type MongoDuplicateError = {
  code?: number;
};

/**
 * Returns the required `petId` path param and rejects missing or malformed
 * Mongo object ids with `HttpError`.
 */
export function getValidatedPetId(event: RouteContext['event']): string {
  const petId = event.pathParameters?.petId;

  if (!petId) {
    throw new HttpError('common.missingPathParams', 400);
  }

  if (!mongoose.isValidObjectId(petId)) {
    throw new HttpError('common.invalidObjectId', 400);
  }

  return petId;
}

/**
 * Removes Mongo internal fields from a pet-source document while preserving
 * the business fields returned to API callers.
 */
export function sanitizeSource(record: PetSourceRecord | null): Record<string, unknown> | null {
  if (!record) {
    return null;
  }

  const raw = typeof record.toObject === 'function' ? record.toObject() : record;
  const { __v, _id, ...safe } = raw as Record<string, unknown> & { __v?: unknown; _id?: unknown };
  return safe;
}

/**
 * Converts known `HttpError`-shaped failures into the domain response format
 * so route handlers can centralize error handling without widening catch
 * blocks.
 */
export function toErrorResponse(
  error: unknown,
  event: RouteContext['event']
): APIGatewayProxyResult | null {
  if (error instanceof HttpError) {
    return response.errorResponse(error.statusCode, error.errorKey, event);
  }

  const statusCode = (error as { statusCode?: unknown })?.statusCode;
  const errorKey = (error as { errorKey?: unknown })?.errorKey;
  if (typeof statusCode === 'number' && typeof errorKey === 'string') {
    return response.errorResponse(statusCode, errorKey, event);
  }

  return null;
}

/**
 * Confirms the caller owns the pet directly or via matching NGO ownership
 * before pet-source records can be read or written.
 */
export async function authorizePetAccess(
  authContext: AuthContext,
  petId: string
): Promise<void> {
  const Pet = mongoose.model('Pet');
  const pet = (await Pet.findOne({ _id: petId, deleted: false })
    .select('_id userId ngoId')
    .lean()) as AuthorizedPet | null;

  if (!pet) {
    throw new HttpError('petSource.errors.petNotFound', 404);
  }

  const isOwner = pet.userId !== null && String(pet.userId) === authContext.userId;
  const isNgoOwner =
    Boolean(authContext.ngoId) && pet.ngoId !== null && String(pet.ngoId) === authContext.ngoId;

  if (!isOwner && !isNgoOwner) {
    throw new HttpError('common.forbidden', 403);
  }
}

/**
 * Translates the optional patch body into Mongo `$set` fields so omitted keys
 * remain unchanged.
 */
export function buildSourceUpdateFields(body: SourcePatchBody): Record<string, unknown> {
  const updateFields: Record<string, unknown> = {};

  if (body.placeofOrigin !== undefined) updateFields.placeofOrigin = body.placeofOrigin;
  if (body.channel !== undefined) updateFields.channel = body.channel;
  if (body.rescueCategory !== undefined) updateFields.rescueCategory = body.rescueCategory;
  if (body.causeOfInjury !== undefined) updateFields.causeOfInjury = body.causeOfInjury;

  return updateFields;
}
