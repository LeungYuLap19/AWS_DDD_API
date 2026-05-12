import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import {
  parseBody,
  paginationQuerySchema,
  parseObjectIdParam,
} from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { response } from '../utils/response';
import { loadAuthorizedPet, requireAuthContext } from '../utils/auth';
import { applyRateLimit } from '../utils/rateLimit';
import { sanitizeRecord } from '../utils/sanitize';
import { isValidDateFormat, parseDDMMYYYY } from '../utils/date';
import {
  createVaccineRecordSchema,
  updateVaccineRecordSchema,
} from '../zodSchema/vaccineSchema';

const PROJECTION =
  'vaccineDate vaccineName vaccineNumber vaccineTimes vaccinePosition petId';

const ACTIVE_FILTER = { isDeleted: { $ne: true } };

/**
 * Returns paginated vaccination records for one owned pet.
 */
export async function handleListVaccineRecords(
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

  const VaccineRecords = mongoose.model('Vaccine_Records');
  const activeFilter = { petId, ...ACTIVE_FILTER };
  const [records, total] = await Promise.all([
    VaccineRecords.find(activeFilter).select(PROJECTION).skip(skip).limit(limit).lean(),
    VaccineRecords.countDocuments(activeFilter),
  ]);

  return response.successResponse(200, ctx.event, {
    message: 'success.retrieved',
    data: records.map((r) => sanitizeRecord(r as Record<string, unknown>)),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}

/**
 * Creates one vaccination record for an owned pet after validating the legacy
 * date format accepted by this domain.
 */
export async function handleCreateVaccineRecord(
  ctx: RouteContext
): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);

  const petIdResult = parseObjectIdParam(ctx.event.pathParameters?.petId);
  if (!petIdResult.ok) {
    return response.errorResponse(petIdResult.statusCode, petIdResult.errorKey, ctx.event);
  }
  const petId = petIdResult.data;

  const parsed = parseBody(ctx.body, createVaccineRecordSchema);
  if (!parsed.ok) {
    return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
  }
  const data = parsed.data;

  if (data.vaccineDate && !isValidDateFormat(data.vaccineDate)) {
    return response.errorResponse(
      400,
      'petMedical.errors.vaccineRecord.invalidDateFormat',
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

  const VaccineRecords = mongoose.model('Vaccine_Records');

  const newRecord = await VaccineRecords.create({
    vaccineDate: data.vaccineDate ? parseDDMMYYYY(data.vaccineDate) : null,
    vaccineName: data.vaccineName,
    vaccineNumber: data.vaccineNumber,
    vaccineTimes: data.vaccineTimes,
    vaccinePosition: data.vaccinePosition,
    petId,
  });

  return response.successResponse(201, ctx.event, {
    message: 'success.created',
    data: sanitizeRecord(newRecord as unknown as Record<string, unknown>),
  });
}

/**
 * Updates one vaccination record for an owned pet using partial-update
 * semantics.
 */
export async function handleUpdateVaccineRecord(
  ctx: RouteContext
): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);

  const petIdResult = parseObjectIdParam(ctx.event.pathParameters?.petId);
  if (!petIdResult.ok) {
    return response.errorResponse(petIdResult.statusCode, petIdResult.errorKey, ctx.event);
  }
  const petId = petIdResult.data;

  const vaccineIdResult = parseObjectIdParam(ctx.event.pathParameters?.vaccineId);
  if (!vaccineIdResult.ok) {
    return response.errorResponse(vaccineIdResult.statusCode, vaccineIdResult.errorKey, ctx.event);
  }
  const vaccineId = vaccineIdResult.data;

  const parsed = parseBody(ctx.body, updateVaccineRecordSchema);
  if (!parsed.ok) {
    return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
  }
  const data = parsed.data;

  if (data.vaccineDate && !isValidDateFormat(data.vaccineDate)) {
    return response.errorResponse(
      400,
      'petMedical.errors.vaccineRecord.invalidDateFormat',
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
  if (data.vaccineDate !== undefined) {
    updateFields.vaccineDate = data.vaccineDate
      ? parseDDMMYYYY(data.vaccineDate)
      : null;
  }
  if (data.vaccineName !== undefined) updateFields.vaccineName = data.vaccineName;
  if (data.vaccineNumber !== undefined) updateFields.vaccineNumber = data.vaccineNumber;
  if (data.vaccineTimes !== undefined) updateFields.vaccineTimes = data.vaccineTimes;
  if (data.vaccinePosition !== undefined) updateFields.vaccinePosition = data.vaccinePosition;

  const VaccineRecords = mongoose.model('Vaccine_Records');
  const updated = await VaccineRecords.findOneAndUpdate(
    { _id: vaccineId, petId, ...ACTIVE_FILTER },
    { $set: updateFields },
    { new: true, projection: PROJECTION }
  ).lean();

  if (!updated) {
    return response.errorResponse(
      404,
      'petMedical.errors.vaccineRecord.notFound',
      ctx.event
    );
  }

  return response.successResponse(200, ctx.event, {
    message: 'success.updated',
    data: sanitizeRecord(updated as Record<string, unknown>),
  });
}

/**
 * Deletes one vaccination record belonging to an owned pet.
 */
export async function handleDeleteVaccineRecord(
  ctx: RouteContext
): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);

  const petIdResult = parseObjectIdParam(ctx.event.pathParameters?.petId);
  if (!petIdResult.ok) {
    return response.errorResponse(petIdResult.statusCode, petIdResult.errorKey, ctx.event);
  }
  const petId = petIdResult.data;

  const vaccineIdResult = parseObjectIdParam(ctx.event.pathParameters?.vaccineId);
  if (!vaccineIdResult.ok) {
    return response.errorResponse(vaccineIdResult.statusCode, vaccineIdResult.errorKey, ctx.event);
  }
  const vaccineId = vaccineIdResult.data;

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

  const VaccineRecords = mongoose.model('Vaccine_Records');

  const deleted = await VaccineRecords.findOneAndUpdate(
    { _id: vaccineId, petId, ...ACTIVE_FILTER },
    { $set: { isDeleted: true, deletedAt: new Date() } },
    { new: true }
  ).lean();
  if (!deleted) {
    return response.errorResponse(
      404,
      'petMedical.errors.vaccineRecord.notFound',
      ctx.event
    );
  }

  return response.successResponse(200, ctx.event, {
    message: 'success.deleted',
  });
}
