import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import {
  parseBody,
  requireAuthContext,
} from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { response } from '../utils/response';
import {
  authorizePetAccess,
  buildSourceUpdateFields,
  getValidatedPetId,
  type MongoDuplicateError,
  type PetSourceRecord,
  sanitizeSource,
  toErrorResponse,
} from '../utils/helpers';
import {
  sourceCreateBodySchema,
  sourcePatchBodySchema,
  type SourceCreateBody,
} from '../zodSchema/sourceSchema';

export async function handleGetPetSource(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  try {
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
        message: 'petSource.success.retrieved',
        form: null,
        petId,
      });
    }

    return response.successResponse(200, ctx.event, {
      message: 'petSource.success.retrieved',
      form: sanitizeSource(record),
      petId,
      sourceId: String(record._id),
    });
  } catch (error) {
    const knownError = toErrorResponse(error, ctx.event);
    if (knownError) return knownError;
    throw error;
  }
}

export async function handleCreatePetSource(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const parsed = parseBody(ctx.body, sourceCreateBodySchema, {
    requireNonEmpty: true,
  });
  if (!parsed.ok) {
    return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
  }

  try {
    const authContext = requireAuthContext(ctx.event);
    const petId = getValidatedPetId(ctx.event);
    await connectToMongoDB();
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
      message: 'petSource.success.created',
      form: sanitizeSource(createdRecord),
      petId,
      sourceId: String(createdRecord._id),
    });
  } catch (error) {
    const knownError = toErrorResponse(error, ctx.event);
    if (knownError) return knownError;
    throw error;
  }
}

export async function handlePatchPetSource(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const parsed = parseBody(ctx.body, sourcePatchBodySchema, {
    requireNonEmpty: true,
  });
  if (!parsed.ok) {
    return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
  }

  const updateFields = buildSourceUpdateFields(parsed.data);
  if (Object.keys(updateFields).length === 0) {
    return response.errorResponse(400, 'common.noFieldsToUpdate', ctx.event);
  }

  try {
    const authContext = requireAuthContext(ctx.event);
    const petId = getValidatedPetId(ctx.event);
    await connectToMongoDB();
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
      message: 'petSource.success.updated',
      petId,
      sourceId,
    });
  } catch (error) {
    const knownError = toErrorResponse(error, ctx.event);
    if (knownError) return knownError;
    throw error;
  }
}
