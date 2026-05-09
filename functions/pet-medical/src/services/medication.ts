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
  createMedicationRecordSchema,
  updateMedicationRecordSchema,
} from '../zodSchema/medicationSchema';

const PROJECTION =
  'medicationDate drugName drugPurpose drugMethod drugRemark allergy petId';

/**
 * Returns paginated medication records for one owned pet.
 */
export async function handleListMedicationRecords(
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

  const MedicationRecords = mongoose.model('Medication_Records');
  const [records, total] = await Promise.all([
    MedicationRecords.find({ petId }).select(PROJECTION).skip(skip).limit(limit).lean(),
    MedicationRecords.countDocuments({ petId }),
  ]);

  return response.successResponse(200, ctx.event, {
    message: 'success.retrieved',
    data: records.map((r) => sanitizeRecord(r as Record<string, unknown>)),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}

/**
 * Creates one medication record for an owned pet after validating the accepted
 * medication date format.
 */
export async function handleCreateMedicationRecord(
  ctx: RouteContext
): Promise<APIGatewayProxyResult> {
  const petId = String(ctx.event.pathParameters?.petId || '');

  const authContext = requireAuthContext(ctx.event);

  const parsed = parseBody(ctx.body, createMedicationRecordSchema);
  if (!parsed.ok) {
    return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
  }
  const data = parsed.data;

  if (data.medicationDate && !isValidDateFormat(data.medicationDate)) {
    return response.errorResponse(
      400,
      'petMedical.errors.medicationRecord.invalidDateFormat',
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

  const MedicationRecords = mongoose.model('Medication_Records');

  const newRecord = await MedicationRecords.create({
    medicationDate: data.medicationDate ? parseDDMMYYYY(data.medicationDate) : null,
    drugName: data.drugName,
    drugPurpose: data.drugPurpose,
    drugMethod: data.drugMethod,
    drugRemark: data.drugRemark,
    allergy: data.allergy ?? false,
    petId,
  });

  return response.successResponse(201, ctx.event, {
    message: 'success.created',
    data: sanitizeRecord(newRecord as unknown as Record<string, unknown>),
  });
}

/**
 * Updates one medication record for an owned pet using partial-update
 * semantics.
 */
export async function handleUpdateMedicationRecord(
  ctx: RouteContext
): Promise<APIGatewayProxyResult> {
  const petId = String(ctx.event.pathParameters?.petId || '');
  const medicationId = String(ctx.event.pathParameters?.medicationId || '');

  const authContext = requireAuthContext(ctx.event);

  if (!mongoose.isValidObjectId(medicationId)) {
    return response.errorResponse(
      400,
      'common.invalidObjectId',
      ctx.event
    );
  }

  const parsed = parseBody(ctx.body, updateMedicationRecordSchema);
  if (!parsed.ok) {
    return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
  }
  const data = parsed.data;

  if (data.medicationDate && !isValidDateFormat(data.medicationDate)) {
    return response.errorResponse(
      400,
      'petMedical.errors.medicationRecord.invalidDateFormat',
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
  if (data.medicationDate !== undefined) {
    updateFields.medicationDate = data.medicationDate
      ? parseDDMMYYYY(data.medicationDate)
      : null;
  }
  if (data.drugName !== undefined) updateFields.drugName = data.drugName;
  if (data.drugPurpose !== undefined) updateFields.drugPurpose = data.drugPurpose;
  if (data.drugMethod !== undefined) updateFields.drugMethod = data.drugMethod;
  if (data.drugRemark !== undefined) updateFields.drugRemark = data.drugRemark;
  if (data.allergy !== undefined) updateFields.allergy = data.allergy;

  const MedicationRecords = mongoose.model('Medication_Records');
  const updated = await MedicationRecords.findOneAndUpdate(
    { _id: medicationId, petId },
    { $set: updateFields },
    { new: true, projection: PROJECTION }
  ).lean();

  if (!updated) {
    return response.errorResponse(
      404,
      'petMedical.errors.medicationRecord.notFound',
      ctx.event
    );
  }

  return response.successResponse(200, ctx.event, {
    message: 'success.updated',
    data: sanitizeRecord(updated as Record<string, unknown>),
  });
}

/**
 * Deletes one medication record belonging to an owned pet.
 */
export async function handleDeleteMedicationRecord(
  ctx: RouteContext
): Promise<APIGatewayProxyResult> {
  const petId = String(ctx.event.pathParameters?.petId || '');
  const medicationId = String(ctx.event.pathParameters?.medicationId || '');

  const authContext = requireAuthContext(ctx.event);

  if (!mongoose.isValidObjectId(medicationId)) {
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

  const MedicationRecords = mongoose.model('Medication_Records');

  const deleted = await MedicationRecords.deleteOne({ _id: medicationId, petId });
  if (deleted.deletedCount === 0) {
    return response.errorResponse(
      404,
      'petMedical.errors.medicationRecord.notFound',
      ctx.event
    );
  }

  return response.successResponse(200, ctx.event, {
    message: 'success.deleted',
  });
}
