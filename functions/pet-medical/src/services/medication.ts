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
import { HttpError } from '../utils/httpError';
import {
  createMedicationRecordSchema,
  updateMedicationRecordSchema,
} from '../zodSchema/medicationSchema';

const PROJECTION =
  'medicationDate drugName drugPurpose drugMethod drugRemark allergy petId';

function handleKnownError(
  error: unknown,
  event: RouteContext['event']
): APIGatewayProxyResult | null {
  if (error instanceof HttpError) {
    return response.errorResponse(error.statusCode, error.errorKey, event);
  }
  return null;
}

export async function handleListMedicationRecords(
  ctx: RouteContext
): Promise<APIGatewayProxyResult> {
  const petId = String(ctx.event.pathParameters?.petId || '');

  requireAuthContext(ctx.event);
  await connectToMongoDB();

  try {
    await loadAuthorizedPet(ctx.event, petId);

    const MedicationRecords = mongoose.model('Medication_Records');
    const records = await MedicationRecords.find({ petId })
      .select(PROJECTION)
      .lean();

    return response.successResponse(200, ctx.event, {
      message: 'petMedicalRecord.success.medicationRecord.getSuccess',
      form: { medication: records.map((r) => sanitizeRecord(r as Record<string, unknown>)) },
      petId,
    });
  } catch (error) {
    const known = handleKnownError(error, ctx.event);
    if (known) return known;
    throw error;
  }
}

export async function handleCreateMedicationRecord(
  ctx: RouteContext
): Promise<APIGatewayProxyResult> {
  const petId = String(ctx.event.pathParameters?.petId || '');

  const authContext = requireAuthContext(ctx.event);
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

  try {
    await loadAuthorizedPet(ctx.event, petId);

    const parsed = parseBody(ctx.body, createMedicationRecordSchema);
    if (!parsed.ok) {
      return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
    }
    const data = parsed.data;

    if (data.medicationDate && !isValidDateFormat(data.medicationDate)) {
      return response.errorResponse(
        400,
        'petMedicalRecord.errors.medicationRecord.invalidDateFormat',
        ctx.event
      );
    }

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
      message: 'petMedicalRecord.success.medicationRecord.created',
      form: sanitizeRecord(newRecord as unknown as Record<string, unknown>),
      petId,
      medicationRecordId: newRecord._id,
    });
  } catch (error) {
    const known = handleKnownError(error, ctx.event);
    if (known) return known;
    throw error;
  }
}

export async function handleUpdateMedicationRecord(
  ctx: RouteContext
): Promise<APIGatewayProxyResult> {
  const petId = String(ctx.event.pathParameters?.petId || '');
  const medicationId = String(ctx.event.pathParameters?.medicationId || '');

  const authContext = requireAuthContext(ctx.event);

  if (!mongoose.isValidObjectId(medicationId)) {
    return response.errorResponse(
      400,
      'petMedicalRecord.errors.medicationRecord.invalidMedicationIdFormat',
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

  try {
    await loadAuthorizedPet(ctx.event, petId);

    const parsed = parseBody(ctx.body, updateMedicationRecordSchema);
    if (!parsed.ok) {
      return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
    }
    const data = parsed.data;

    if (data.medicationDate && !isValidDateFormat(data.medicationDate)) {
      return response.errorResponse(
        400,
        'petMedicalRecord.errors.medicationRecord.invalidDateFormat',
        ctx.event
      );
    }

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
        'petMedicalRecord.errors.medicationRecord.notFound',
        ctx.event
      );
    }

    return response.successResponse(200, ctx.event, {
      message: 'petMedicalRecord.success.medicationRecord.updated',
      petId,
      medicationRecordId: medicationId,
      form: sanitizeRecord(updated as Record<string, unknown>),
    });
  } catch (error) {
    const known = handleKnownError(error, ctx.event);
    if (known) return known;
    throw error;
  }
}

export async function handleDeleteMedicationRecord(
  ctx: RouteContext
): Promise<APIGatewayProxyResult> {
  const petId = String(ctx.event.pathParameters?.petId || '');
  const medicationId = String(ctx.event.pathParameters?.medicationId || '');

  const authContext = requireAuthContext(ctx.event);

  if (!mongoose.isValidObjectId(medicationId)) {
    return response.errorResponse(
      400,
      'petMedicalRecord.errors.medicationRecord.invalidMedicationIdFormat',
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

  try {
    await loadAuthorizedPet(ctx.event, petId);

    const MedicationRecords = mongoose.model('Medication_Records');

    const deleted = await MedicationRecords.deleteOne({ _id: medicationId, petId });
    if (deleted.deletedCount === 0) {
      return response.errorResponse(
        404,
        'petMedicalRecord.errors.medicationRecord.notFound',
        ctx.event
      );
    }

    return response.successResponse(200, ctx.event, {
      message: 'petMedicalRecord.success.medicationRecord.deleted',
      petId,
      medicationRecordId: medicationId,
    });
  } catch (error) {
    const known = handleKnownError(error, ctx.event);
    if (known) return known;
    throw error;
  }
}
