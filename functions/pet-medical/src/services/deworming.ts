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
  createDewormRecordSchema,
  updateDewormRecordSchema,
} from '../zodSchema/dewormSchema';

const PROJECTION =
  'date vaccineBrand vaccineType typesOfInternalParasites typesOfExternalParasites frequency nextDewormDate notification petId';

function handleKnownError(
  error: unknown,
  event: RouteContext['event']
): APIGatewayProxyResult | null {
  if (error instanceof HttpError) {
    return response.errorResponse(error.statusCode, error.errorKey, event);
  }
  return null;
}

export async function handleListDewormRecords(
  ctx: RouteContext
): Promise<APIGatewayProxyResult> {
  const petId = String(ctx.event.pathParameters?.petId || '');

  requireAuthContext(ctx.event);
  await connectToMongoDB();

  try {
    await loadAuthorizedPet(ctx.event, petId);

    const DewormRecords = mongoose.model('Deworm_Records');
    const records = await DewormRecords.find({ petId })
      .select(PROJECTION)
      .lean();

    return response.successResponse(200, ctx.event, {
      message: 'petMedicalRecord.success.dewormRecord.getSuccess',
      form: { deworm: records.map((r) => sanitizeRecord(r as Record<string, unknown>)) },
      petId,
    });
  } catch (error) {
    const known = handleKnownError(error, ctx.event);
    if (known) return known;
    throw error;
  }
}

export async function handleCreateDewormRecord(
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

    const parsed = parseBody(ctx.body, createDewormRecordSchema);
    if (!parsed.ok) {
      return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
    }
    const data = parsed.data;

    if (data.date && !isValidDateFormat(data.date)) {
      return response.errorResponse(
        400,
        'petMedicalRecord.errors.dewormRecord.invalidDateFormat',
        ctx.event
      );
    }
    if (data.nextDewormDate && !isValidDateFormat(data.nextDewormDate)) {
      return response.errorResponse(
        400,
        'petMedicalRecord.errors.dewormRecord.invalidDateFormat',
        ctx.event
      );
    }

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

    return response.successResponse(201, ctx.event, {
      message: 'petMedicalRecord.success.dewormRecord.created',
      form: sanitizeRecord(newRecord as unknown as Record<string, unknown>),
      petId,
      dewormRecordId: newRecord._id,
    });
  } catch (error) {
    const known = handleKnownError(error, ctx.event);
    if (known) return known;
    throw error;
  }
}

export async function handleUpdateDewormRecord(
  ctx: RouteContext
): Promise<APIGatewayProxyResult> {
  const petId = String(ctx.event.pathParameters?.petId || '');
  const dewormId = String(ctx.event.pathParameters?.dewormId || '');

  const authContext = requireAuthContext(ctx.event);

  if (!mongoose.isValidObjectId(dewormId)) {
    return response.errorResponse(
      400,
      'petMedicalRecord.errors.dewormRecord.invalidDewormIdFormat',
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

    const parsed = parseBody(ctx.body, updateDewormRecordSchema);
    if (!parsed.ok) {
      return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
    }
    const data = parsed.data;

    if (data.date && !isValidDateFormat(data.date)) {
      return response.errorResponse(
        400,
        'petMedicalRecord.errors.dewormRecord.invalidDateFormat',
        ctx.event
      );
    }
    if (data.nextDewormDate && !isValidDateFormat(data.nextDewormDate)) {
      return response.errorResponse(
        400,
        'petMedicalRecord.errors.dewormRecord.invalidDateFormat',
        ctx.event
      );
    }

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
        'petMedicalRecord.errors.dewormRecord.notFound',
        ctx.event
      );
    }

    return response.successResponse(200, ctx.event, {
      message: 'petMedicalRecord.success.dewormRecord.updated',
      petId,
      dewormRecordId: dewormId,
      form: sanitizeRecord(updated as Record<string, unknown>),
    });
  } catch (error) {
    const known = handleKnownError(error, ctx.event);
    if (known) return known;
    throw error;
  }
}

export async function handleDeleteDewormRecord(
  ctx: RouteContext
): Promise<APIGatewayProxyResult> {
  const petId = String(ctx.event.pathParameters?.petId || '');
  const dewormId = String(ctx.event.pathParameters?.dewormId || '');

  const authContext = requireAuthContext(ctx.event);

  if (!mongoose.isValidObjectId(dewormId)) {
    return response.errorResponse(
      400,
      'petMedicalRecord.errors.dewormRecord.invalidDewormIdFormat',
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

    const DewormRecords = mongoose.model('Deworm_Records');

    const deleted = await DewormRecords.deleteOne({ _id: dewormId, petId });
    if (deleted.deletedCount === 0) {
      return response.errorResponse(
        404,
        'petMedicalRecord.errors.dewormRecord.notFound',
        ctx.event
      );
    }

    return response.successResponse(200, ctx.event, {
      message: 'petMedicalRecord.success.dewormRecord.deleted',
      petId,
      dewormRecordId: dewormId,
    });
  } catch (error) {
    const known = handleKnownError(error, ctx.event);
    if (known) return known;
    throw error;
  }
}
