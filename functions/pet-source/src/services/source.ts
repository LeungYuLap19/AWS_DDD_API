import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { requireAuthContext } from '@aws-ddd-api/shared/auth/context';
import { parseBody } from '@aws-ddd-api/shared/validation/zod';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { applyRateLimit } from '../utils/rateLimit';
import { response } from '../utils/response';
import {
  authorizePetAccess,
  buildSourceUpdateFields,
  getValidatedPetId,
  type MongoDuplicateError,
  type PetSourceRecord,
  sanitizeSource,
} from '../utils/helpers';
import {
  sourceCreateBodySchema,
  sourcePatchBodySchema,
  type SourceCreateBody,
} from '../zodSchema/sourceSchema';

/**
 * Returns the pet-source record for one owned pet. Missing records are a
 * successful `null` payload rather than a 404 because the source slice is
 * optional.
 */
export async function handleGetPetSource(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);
  const petId = getValidatedPetId(ctx.event);
  await connectToMongoDB();
  await authorizePetAccess(authContext, petId);

  const SourceModel = mongoose.model('pet_sources');
  const record = (await SourceModel.findOne({ petId })
    .select('_id placeofOrigin channel rescueCategory causeOfInjury createdAt updatedAt')
    .lean()) as PetSourceRecord | null;

  if (!record) {
    return response.successResponse(200, ctx.event, {
      message: 'success.retrieved',
      data: null,
    });
  }

  return response.successResponse(200, ctx.event, {
    message: 'success.retrieved',
    data: { id: String(record._id), ...sanitizeSource(record) },
  });
}

/**
 * Creates the single pet-source record allowed for one owned pet, preserving
 * duplicate protection on both the read path and Mongo unique-key failures.
 */
export async function handleCreatePetSource(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);

  const parsed = parseBody(ctx.body, sourceCreateBodySchema);
  if (!parsed.ok) {
    return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
  }

  const petId = getValidatedPetId(ctx.event);
  await connectToMongoDB();

  const rateLimitResponse = await applyRateLimit({
    action: 'petSource.create',
    event: ctx.event,
    identifier: authContext.userId,
    policies: [
      { scope: 'ip', limit: 120, windowSeconds: 5 * 60 },
      { scope: 'identifier', limit: 60, windowSeconds: 5 * 60 },
    ],
  });
  if (rateLimitResponse) return rateLimitResponse;

  await authorizePetAccess(authContext, petId);

  const SourceModel = mongoose.model('pet_sources');
  const existing = (await SourceModel.findOne({ petId }).select('_id').lean()) as
    | { _id: unknown }
    | null;
  if (existing) {
    return response.errorResponse(409, 'petSource.errors.duplicateRecord', ctx.event);
  }

  const data = parsed.data as SourceCreateBody;
  let createdRecord: PetSourceRecord;

  try {
    createdRecord = (await SourceModel.create({
      petId,
      placeofOrigin: data.placeofOrigin || null,
      channel: data.channel || null,
      rescueCategory: data.rescueCategory || [],
      causeOfInjury: data.causeOfInjury || null,
    })) as PetSourceRecord;
  } catch (error) {
    if ((error as MongoDuplicateError).code === 11000) {
      return response.errorResponse(409, 'petSource.errors.duplicateRecord', ctx.event);
    }

    throw error;
  }

  return response.successResponse(201, ctx.event, {
    message: 'success.created',
    data: { id: String(createdRecord._id), ...sanitizeSource(createdRecord) },
  });
}

/**
 * Partially updates the existing pet-source record for one owned pet after
 * patch-body normalization into Mongo `$set` fields.
 */
export async function handlePatchPetSource(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);

  const parsed = parseBody(ctx.body, sourcePatchBodySchema);
  if (!parsed.ok) {
    return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
  }

  const updateFields = buildSourceUpdateFields(parsed.data);
  if (Object.keys(updateFields).length === 0) {
    return response.errorResponse(400, 'common.noFieldsToUpdate', ctx.event);
  }

  const petId = getValidatedPetId(ctx.event);
  await connectToMongoDB();

  const rateLimitResponse = await applyRateLimit({
    action: 'petSource.update',
    event: ctx.event,
    identifier: authContext.userId,
    policies: [
      { scope: 'ip', limit: 120, windowSeconds: 5 * 60 },
      { scope: 'identifier', limit: 60, windowSeconds: 5 * 60 },
    ],
  });
  if (rateLimitResponse) return rateLimitResponse;

  await authorizePetAccess(authContext, petId);

  const SourceModel = mongoose.model('pet_sources');
  const existing = (await SourceModel.findOne({ petId }).select('_id').lean()) as
    | { _id: unknown }
    | null;
  if (!existing) {
    return response.errorResponse(404, 'petSource.errors.recordNotFound', ctx.event);
  }

  const sourceId = String(existing._id);
  const updateResult = await SourceModel.updateOne(
    { _id: sourceId, petId },
    { $set: updateFields }
  );

  if ((updateResult as { matchedCount?: number }).matchedCount === 0) {
    return response.errorResponse(404, 'petSource.errors.recordNotFound', ctx.event);
  }

  return response.successResponse(200, ctx.event, {
    message: 'success.updated',
  });
}
