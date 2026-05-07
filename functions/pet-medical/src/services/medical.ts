import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { parseBody } from '@aws-ddd-api/shared';
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

export async function handleListMedicalRecords(
  ctx: RouteContext
): Promise<APIGatewayProxyResult> {
  const petId = String(ctx.event.pathParameters?.petId || '');

  requireAuthContext(ctx.event);
  await connectToMongoDB();

  await loadAuthorizedPet(ctx.event, petId);

  const MedicalRecords = mongoose.model('Medical_Records');
  const records = await MedicalRecords.find({ petId })
    .select(PROJECTION)
    .lean();

  return response.successResponse(200, ctx.event, {
    message: 'petMedicalRecord.success.medicalRecord.getSuccess',
    form: { medical: records.map((r) => sanitizeRecord(r as Record<string, unknown>)) },
    petId,
  });
}

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
      'petMedicalRecord.errors.medicalRecord.invalidDateFormat',
      ctx.event
    );
  }

  await connectToMongoDB();

  const rateLimitResponse = await applyRateLimit({
    action: 'petMedicalRecord.create',
    event: ctx.event,
    identifier: authContext.userId,
    limit: 20,
    windowSeconds: 300,
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
    message: 'petMedicalRecord.success.medicalRecord.created',
    form: sanitizeRecord(newRecord as unknown as Record<string, unknown>),
    petId,
    medicalRecordId: newRecord._id,
  });
}

export async function handleUpdateMedicalRecord(
  ctx: RouteContext
): Promise<APIGatewayProxyResult> {
  const petId = String(ctx.event.pathParameters?.petId || '');
  const medicalId = String(ctx.event.pathParameters?.medicalId || '');

  const authContext = requireAuthContext(ctx.event);

  if (!mongoose.isValidObjectId(medicalId)) {
    return response.errorResponse(
      400,
      'petMedicalRecord.errors.medicalRecord.invalidMedicalIdFormat',
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
      'petMedicalRecord.errors.medicalRecord.invalidDateFormat',
      ctx.event
    );
  }

  await connectToMongoDB();

  const rateLimitResponse = await applyRateLimit({
    action: 'petMedicalRecord.update',
    event: ctx.event,
    identifier: authContext.userId,
    limit: 30,
    windowSeconds: 300,
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
      'petMedicalRecord.errors.medicalRecord.notFound',
      ctx.event
    );
  }

  return response.successResponse(200, ctx.event, {
    message: 'petMedicalRecord.success.medicalRecord.updated',
    petId,
    medicalRecordId: medicalId,
    form: sanitizeRecord(updated as Record<string, unknown>),
  });
}

export async function handleDeleteMedicalRecord(
  ctx: RouteContext
): Promise<APIGatewayProxyResult> {
  const petId = String(ctx.event.pathParameters?.petId || '');
  const medicalId = String(ctx.event.pathParameters?.medicalId || '');

  const authContext = requireAuthContext(ctx.event);

  if (!mongoose.isValidObjectId(medicalId)) {
    return response.errorResponse(
      400,
      'petMedicalRecord.errors.medicalRecord.invalidMedicalIdFormat',
      ctx.event
    );
  }

  await connectToMongoDB();

  const rateLimitResponse = await applyRateLimit({
    action: 'petMedicalRecord.delete',
    event: ctx.event,
    identifier: authContext.userId,
    limit: 10,
    windowSeconds: 60,
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
      'petMedicalRecord.errors.medicalRecord.notFound',
      ctx.event
    );
  }

  return response.successResponse(200, ctx.event, {
    message: 'petMedicalRecord.success.medicalRecord.deleted',
    petId,
    medicalRecordId: medicalId,
  });
}
