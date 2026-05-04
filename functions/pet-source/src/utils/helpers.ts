import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { type AuthContext, AuthContextError } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { response } from './response';
import type { SourcePatchBody } from '../zodSchema/sourceSchema';

type AuthorizedPet = {
  _id: unknown;
  userId?: unknown;
  ngoId?: unknown;
};

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

export type MongoDuplicateError = {
  code?: number;
};

export function getValidatedPetId(event: RouteContext['event']): string {
  const petId = event.pathParameters?.petId;

  if (!petId) {
    throw new AuthContextError('petSource.errors.missingPetId', 400);
  }

  if (!mongoose.isValidObjectId(petId)) {
    throw new AuthContextError('petSource.errors.invalidPetId', 400);
  }

  return petId;
}

export function sanitizeSource(record: PetSourceRecord | null): Record<string, unknown> | null {
  if (!record) {
    return null;
  }

  const raw = typeof record.toObject === 'function' ? record.toObject() : record;
  const { __v, _id, ...safe } = raw as Record<string, unknown> & { __v?: unknown; _id?: unknown };
  return safe;
}

export function toErrorResponse(
  error: unknown,
  event: RouteContext['event']
): APIGatewayProxyResult | null {
  if (error instanceof AuthContextError) {
    return response.errorResponse(error.statusCode, error.errorKey, event);
  }

  const statusCode = (error as { statusCode?: unknown })?.statusCode;
  const errorKey = (error as { errorKey?: unknown })?.errorKey;
  if (typeof statusCode === 'number' && typeof errorKey === 'string') {
    return response.errorResponse(statusCode, errorKey, event);
  }

  return null;
}

export async function authorizePetAccess(
  authContext: AuthContext,
  petId: string
): Promise<void> {
  const Pet = mongoose.model('Pet');
  const pet = (await Pet.findOne({ _id: petId, deleted: false })
    .select('_id userId ngoId')
    .lean()) as AuthorizedPet | null;

  if (!pet) {
    throw new AuthContextError('petSource.errors.petNotFound', 404);
  }

  const isOwner = pet.userId !== null && String(pet.userId) === authContext.userId;
  const isNgoOwner =
    Boolean(authContext.ngoId) && pet.ngoId !== null && String(pet.ngoId) === authContext.ngoId;

  if (!isOwner && !isNgoOwner) {
    throw new AuthContextError('common.forbidden', 403);
  }
}

export function buildSourceUpdateFields(body: SourcePatchBody): Record<string, unknown> {
  const updateFields: Record<string, unknown> = {};

  if (body.placeofOrigin !== undefined) updateFields.placeofOrigin = body.placeofOrigin;
  if (body.channel !== undefined) updateFields.channel = body.channel;
  if (body.rescueCategory !== undefined) updateFields.rescueCategory = body.rescueCategory;
  if (body.causeOfInjury !== undefined) updateFields.causeOfInjury = body.causeOfInjury;

  return updateFields;
}
