import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { paginationQuerySchema, parseObjectIdParam } from '@aws-ddd-api/shared/validation/common';
import { parseBody } from '@aws-ddd-api/shared/validation/zod';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { response } from '../utils/response';
import { loadAuthorizedPet, requireAuthContext } from '../utils/auth';
import { applyRateLimit } from '../utils/rateLimit';
import { sanitizeRecord } from '../utils/sanitize';
import { syncPetMedicalCounters } from '../utils/petCounters';
import { isValidDateFormat, parseDDMMYYYY } from '../utils/date';
import {
  createDewormRecordSchema,
  updateDewormRecordSchema,
} from '../zodSchema/dewormSchema';

const PROJECTION =
  'date vaccineBrand vaccineType typesOfInternalParasites typesOfExternalParasites frequency nextDewormDate notification petId';

/**
 * Returns paginated deworming records for one owned pet.
 */
export async function handleListDewormRecords(
  ctx: RouteContext
): Promise<APIGatewayProxyResult> {
  requireAuthContext(ctx.event);

  const petIdResult = parseObjectIdParam(ctx.event.pathParameters?.petId);
  if (!petIdResult.ok) {
    return response.errorResponse(petIdResult.statusCode, petIdResult.errorKey, ctx.event);
  }
  const petId = petIdResult.data;

  await connectToMongoDB();

  await loadAuthorizedPet(ctx.event, petId);

  const pagination = paginationQuerySchema().safeParse(ctx.event.queryStringParameters ?? {});
  if (!pagination.success) {
    return response.errorResponse(400, 'common.invalidQueryParams', ctx.event);
  }
  const { page, limit } = pagination.data;
  const skip = (page - 1) * limit;

  const DewormRecords = mongoose.model('Deworm_Records');
  const [records, total] = await Promise.all([
    DewormRecords.find({ petId }).select(PROJECTION).skip(skip).limit(limit).lean(),
    DewormRecords.countDocuments({ petId }),
  ]);

  return response.successResponse(200, ctx.event, {
    message: 'success.retrieved',
    data: records.map((r) => sanitizeRecord(r as Record<string, unknown>)),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}

/**
 * Creates one deworming record for an owned pet, validating both the treatment
 * date and optional next-reminder date.
 */
export async function handleCreateDewormRecord(
  ctx: RouteContext
): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);

  const petIdResult = parseObjectIdParam(ctx.event.pathParameters?.petId);
  if (!petIdResult.ok) {
    return response.errorResponse(petIdResult.statusCode, petIdResult.errorKey, ctx.event);
  }
  const petId = petIdResult.data;

  const parsed = parseBody(ctx.body, createDewormRecordSchema);
  if (!parsed.ok) {
    return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
  }
  const data = parsed.data;

  if (data.date && !isValidDateFormat(data.date)) {
    return response.errorResponse(
      400,
      'petMedical.errors.dewormRecord.invalidDateFormat',
      ctx.event
    );
  }
  if (data.nextDewormDate && !isValidDateFormat(data.nextDewormDate)) {
    return response.errorResponse(
      400,
      'petMedical.errors.dewormRecord.invalidDateFormat',
      ctx.event
    );
  }

  await connectToMongoDB();

  const rateLimitResponse = await applyRateLimit({
    action: 'petMedical.create',
    event: ctx.event,
    identifier: authContext.userId,
    policies: [
      { scope: 'ip', limit: 60, windowSeconds: 300 },
      { scope: 'identifier', limit: 30, windowSeconds: 300 },
      { scope: 'ip+identifier', limit: 20, windowSeconds: 300 },
    ],
  });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  await loadAuthorizedPet(ctx.event, petId);

  const DewormRecords = mongoose.model('Deworm_Records');

  const parsedDate = data.date ? parseDDMMYYYY(data.date) : null;
  const parsedNextDewormDate = data.nextDewormDate
    ? parseDDMMYYYY(data.nextDewormDate)
    : null;

  const newRecord = await DewormRecords.create({
    date: parsedDate,
    vaccineBrand: data.vaccineBrand,
    vaccineType: data.vaccineType,
    typesOfInternalParasites: data.typesOfInternalParasites,
    typesOfExternalParasites: data.typesOfExternalParasites,
    frequency: data.frequency,
    nextDewormDate: parsedNextDewormDate,
    notification: data.notification ?? false,
    petId,
  });
  await syncPetMedicalCounters({ petId, updateLatestDeworm: true });

  return response.successResponse(201, ctx.event, {
    message: 'success.created',
    data: sanitizeRecord(newRecord as unknown as Record<string, unknown>),
  });
}

/**
 * Updates one deworming record for an owned pet using partial-update
 * semantics.
 */
export async function handleUpdateDewormRecord(
  ctx: RouteContext
): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);

  const petIdResult = parseObjectIdParam(ctx.event.pathParameters?.petId);
  if (!petIdResult.ok) {
    return response.errorResponse(petIdResult.statusCode, petIdResult.errorKey, ctx.event);
  }
  const petId = petIdResult.data;

  const dewormIdResult = parseObjectIdParam(ctx.event.pathParameters?.dewormId);
  if (!dewormIdResult.ok) {
    return response.errorResponse(dewormIdResult.statusCode, dewormIdResult.errorKey, ctx.event);
  }
  const dewormId = dewormIdResult.data;

  const parsed = parseBody(ctx.body, updateDewormRecordSchema);
  if (!parsed.ok) {
    return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
  }
  const data = parsed.data;

  if (data.date && !isValidDateFormat(data.date)) {
    return response.errorResponse(
      400,
      'petMedical.errors.dewormRecord.invalidDateFormat',
      ctx.event
    );
  }
  if (data.nextDewormDate && !isValidDateFormat(data.nextDewormDate)) {
    return response.errorResponse(
      400,
      'petMedical.errors.dewormRecord.invalidDateFormat',
      ctx.event
    );
  }

  await connectToMongoDB();

  const rateLimitResponse = await applyRateLimit({
    action: 'petMedical.update',
    event: ctx.event,
    identifier: authContext.userId,
    policies: [
      { scope: 'ip', limit: 90, windowSeconds: 300 },
      { scope: 'identifier', limit: 45, windowSeconds: 300 },
      { scope: 'ip+identifier', limit: 30, windowSeconds: 300 },
    ],
  });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  await loadAuthorizedPet(ctx.event, petId);

  const updateFields: Record<string, unknown> = {};
  if (data.date !== undefined) updateFields.date = data.date ? parseDDMMYYYY(data.date) : null;
  if (data.vaccineBrand !== undefined) updateFields.vaccineBrand = data.vaccineBrand;
  if (data.vaccineType !== undefined) updateFields.vaccineType = data.vaccineType;
  if (data.typesOfInternalParasites !== undefined)
    updateFields.typesOfInternalParasites = data.typesOfInternalParasites;
  if (data.typesOfExternalParasites !== undefined)
    updateFields.typesOfExternalParasites = data.typesOfExternalParasites;
  if (data.frequency !== undefined) updateFields.frequency = data.frequency;
  if (data.nextDewormDate !== undefined)
    updateFields.nextDewormDate = data.nextDewormDate
      ? parseDDMMYYYY(data.nextDewormDate)
      : null;
  if (data.notification !== undefined) updateFields.notification = data.notification;

  const DewormRecords = mongoose.model('Deworm_Records');
  const updated = await DewormRecords.findOneAndUpdate(
    { _id: dewormId, petId },
    { $set: updateFields },
    { new: true, projection: PROJECTION }
  ).lean();

  if (!updated) {
    return response.errorResponse(
      404,
      'petMedical.errors.dewormRecord.notFound',
      ctx.event
    );
  }
  await syncPetMedicalCounters({ petId, updateLatestDeworm: true });

  return response.successResponse(200, ctx.event, {
    message: 'success.updated',
    data: sanitizeRecord(updated as Record<string, unknown>),
  });
}

/**
 * Deletes one deworming record belonging to an owned pet.
 */
export async function handleDeleteDewormRecord(
  ctx: RouteContext
): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);

  const petIdResult = parseObjectIdParam(ctx.event.pathParameters?.petId);
  if (!petIdResult.ok) {
    return response.errorResponse(petIdResult.statusCode, petIdResult.errorKey, ctx.event);
  }
  const petId = petIdResult.data;

  const dewormIdResult = parseObjectIdParam(ctx.event.pathParameters?.dewormId);
  if (!dewormIdResult.ok) {
    return response.errorResponse(dewormIdResult.statusCode, dewormIdResult.errorKey, ctx.event);
  }
  const dewormId = dewormIdResult.data;

  await connectToMongoDB();

  const rateLimitResponse = await applyRateLimit({
    action: 'petMedical.delete',
    event: ctx.event,
    identifier: authContext.userId,
    policies: [
      { scope: 'ip', limit: 30, windowSeconds: 60 },
      { scope: 'identifier', limit: 15, windowSeconds: 60 },
      { scope: 'ip+identifier', limit: 10, windowSeconds: 60 },
    ],
  });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  await loadAuthorizedPet(ctx.event, petId);

  const DewormRecords = mongoose.model('Deworm_Records');

  const deleted = await DewormRecords.deleteOne({ _id: dewormId, petId });
  if (deleted.deletedCount === 0) {
    return response.errorResponse(
      404,
      'petMedical.errors.dewormRecord.notFound',
      ctx.event
    );
  }
  await syncPetMedicalCounters({ petId, updateLatestDeworm: true });

  return response.successResponse(200, ctx.event, {
    message: 'success.deleted',
  });
}
