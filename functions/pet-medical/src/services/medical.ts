import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { parseBody, paginationQuerySchema } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { response } from '../utils/response';
import { loadAuthorizedPet, requireAuthContext } from '../utils/auth';
import { applyRateLimit } from '../utils/rateLimit';
import { sanitizeRecord } from '../utils/sanitize';
import { isValidDateFormat, parseDDMMYYYY } from '../utils/date';
import {
  createMedicalRecordSchema,
  updateMedicalRecordSchema,
} from '../zodSchema/medicalSchema';

const PROJECTION =
  'medicalDate medicalPlace medicalDoctor medicalResult medicalSolution petId';

/**
 * Returns paginated medical records for one owned pet after ownership
 * validation.
 */
export async function handleListMedicalRecords(
  ctx: RouteContext
): Promise<APIGatewayProxyResult> {
  const petId = String(ctx.event.pathParameters?.petId || '');

  requireAuthContext(ctx.event);
  await connectToMongoDB();

  await loadAuthorizedPet(ctx.event, petId);

  const pagination = paginationQuerySchema().safeParse(ctx.event.queryStringParameters ?? {});
  if (!pagination.success) {
    return response.errorResponse(400, 'common.invalidQueryParams', ctx.event);
  }
  const { page, limit } = pagination.data;
  const skip = (page - 1) * limit;

  const MedicalRecords = mongoose.model('Medical_Records');
  const [records, total] = await Promise.all([
    MedicalRecords.find({ petId }).select(PROJECTION).skip(skip).limit(limit).lean(),
    MedicalRecords.countDocuments({ petId }),
  ]);

  return response.successResponse(200, ctx.event, {
    message: 'success.retrieved',
    data: records.map((r) => sanitizeRecord(r as Record<string, unknown>)),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}

/**
 * Creates one medical record for an owned pet after validating the legacy date
 * format accepted by this domain.
 */
export async function handleCreateMedicalRecord(
  ctx: RouteContext
): Promise<APIGatewayProxyResult> {
  const petId = String(ctx.event.pathParameters?.petId || '');

  const authContext = requireAuthContext(ctx.event);

  const parsed = parseBody(ctx.body, createMedicalRecordSchema);
  if (!parsed.ok) {
    return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
  }
  const data = parsed.data;

  if (data.medicalDate && !isValidDateFormat(data.medicalDate)) {
    return response.errorResponse(
      400,
      'petMedical.errors.medicalRecord.invalidDateFormat',
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

  const MedicalRecords = mongoose.model('Medical_Records');

  const newRecord = await MedicalRecords.create({
    medicalDate: data.medicalDate ? parseDDMMYYYY(data.medicalDate) : null,
    medicalPlace: data.medicalPlace,
    medicalDoctor: data.medicalDoctor,
    medicalResult: data.medicalResult,
    medicalSolution: data.medicalSolution,
    petId,
  });

  return response.successResponse(201, ctx.event, {
    message: 'success.created',
    data: sanitizeRecord(newRecord as unknown as Record<string, unknown>),
  });
}

/**
 * Updates one medical record for an owned pet, mapping omitted fields to
 * partial-update semantics rather than full replacement.
 */
export async function handleUpdateMedicalRecord(
  ctx: RouteContext
): Promise<APIGatewayProxyResult> {
  const petId = String(ctx.event.pathParameters?.petId || '');
  const medicalId = String(ctx.event.pathParameters?.medicalId || '');

  const authContext = requireAuthContext(ctx.event);

  if (!mongoose.isValidObjectId(medicalId)) {
    return response.errorResponse(
      400,
      'common.invalidObjectId',
      ctx.event
    );
  }

  const parsed = parseBody(ctx.body, updateMedicalRecordSchema);
  if (!parsed.ok) {
    return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
  }
  const data = parsed.data;

  if (data.medicalDate && !isValidDateFormat(data.medicalDate)) {
    return response.errorResponse(
      400,
      'petMedical.errors.medicalRecord.invalidDateFormat',
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
  if (data.medicalDate !== undefined) {
    updateFields.medicalDate = data.medicalDate ? parseDDMMYYYY(data.medicalDate) : null;
  }
  if (data.medicalPlace !== undefined) updateFields.medicalPlace = data.medicalPlace;
  if (data.medicalDoctor !== undefined) updateFields.medicalDoctor = data.medicalDoctor;
  if (data.medicalResult !== undefined) updateFields.medicalResult = data.medicalResult;
  if (data.medicalSolution !== undefined) updateFields.medicalSolution = data.medicalSolution;

  const MedicalRecords = mongoose.model('Medical_Records');
  const updated = await MedicalRecords.findOneAndUpdate(
    { _id: medicalId, petId },
    { $set: updateFields },
    { new: true, projection: PROJECTION }
  ).lean();

  if (!updated) {
    return response.errorResponse(
      404,
      'petMedical.errors.medicalRecord.notFound',
      ctx.event
    );
  }

  return response.successResponse(200, ctx.event, {
    message: 'success.updated',
    data: sanitizeRecord(updated as Record<string, unknown>),
  });
}

/**
 * Deletes one medical record belonging to an owned pet.
 */
export async function handleDeleteMedicalRecord(
  ctx: RouteContext
): Promise<APIGatewayProxyResult> {
  const petId = String(ctx.event.pathParameters?.petId || '');
  const medicalId = String(ctx.event.pathParameters?.medicalId || '');

  const authContext = requireAuthContext(ctx.event);

  if (!mongoose.isValidObjectId(medicalId)) {
    return response.errorResponse(
      400,
      'common.invalidObjectId',
      ctx.event
    );
  }

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

  const MedicalRecords = mongoose.model('Medical_Records');

  const deleted = await MedicalRecords.deleteOne({ _id: medicalId, petId });
  if (deleted.deletedCount === 0) {
    return response.errorResponse(
      404,
      'petMedical.errors.medicalRecord.notFound',
      ctx.event
    );
  }

  return response.successResponse(200, ctx.event, {
    message: 'success.deleted',
  });
}
