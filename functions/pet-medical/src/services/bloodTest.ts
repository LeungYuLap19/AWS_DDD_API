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
  createBloodTestSchema,
  updateBloodTestSchema,
} from '../zodSchema/bloodTestSchema';

const PROJECTION =
  'bloodTestDate heartworm lymeDisease ehrlichiosis anaplasmosis babesiosis petId';

function handleKnownError(
  error: unknown,
  event: RouteContext['event']
): APIGatewayProxyResult | null {
  if (error instanceof HttpError) {
    return response.errorResponse(error.statusCode, error.errorKey, event);
  }
  return null;
}

export async function handleListBloodTestRecords(
  ctx: RouteContext
): Promise<APIGatewayProxyResult> {
  const petId = String(ctx.event.pathParameters?.petId || '');

  requireAuthContext(ctx.event);
  await connectToMongoDB();

  try {
    await loadAuthorizedPet(ctx.event, petId);

    const BloodTest = mongoose.model('blood_tests');
    const records = await BloodTest.find({ petId })
      .select(PROJECTION)
      .lean();

    return response.successResponse(200, ctx.event, {
      message: 'petMedicalRecord.success.bloodTest.getSuccess',
      form: { blood_test: records.map((r) => sanitizeRecord(r as Record<string, unknown>)) },
      petId,
    });
  } catch (error) {
    const known = handleKnownError(error, ctx.event);
    if (known) return known;
    throw error;
  }
}

export async function handleCreateBloodTestRecord(
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

    const parsed = parseBody(ctx.body, createBloodTestSchema);
    if (!parsed.ok) {
      return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
    }
    const data = parsed.data;

    if (data.bloodTestDate && !isValidDateFormat(data.bloodTestDate)) {
      return response.errorResponse(
        400,
        'petMedicalRecord.errors.bloodTest.invalidDateFormat',
        ctx.event
      );
    }

    const BloodTest = mongoose.model('blood_tests');

    const parsedBloodTestDate = data.bloodTestDate ? parseDDMMYYYY(data.bloodTestDate) : null;

    const newRecord = await BloodTest.create({
      bloodTestDate: parsedBloodTestDate,
      heartworm: data.heartworm,
      lymeDisease: data.lymeDisease,
      ehrlichiosis: data.ehrlichiosis,
      anaplasmosis: data.anaplasmosis,
      babesiosis: data.babesiosis,
      petId,
    });

    return response.successResponse(201, ctx.event, {
      message: 'petMedicalRecord.success.bloodTest.created',
      form: sanitizeRecord(newRecord as unknown as Record<string, unknown>),
      petId,
      bloodTestRecordId: newRecord._id,
    });
  } catch (error) {
    const known = handleKnownError(error, ctx.event);
    if (known) return known;
    throw error;
  }
}

export async function handleUpdateBloodTestRecord(
  ctx: RouteContext
): Promise<APIGatewayProxyResult> {
  const petId = String(ctx.event.pathParameters?.petId || '');
  const bloodTestId = String(ctx.event.pathParameters?.bloodTestId || '');

  const authContext = requireAuthContext(ctx.event);

  if (!mongoose.isValidObjectId(bloodTestId)) {
    return response.errorResponse(
      400,
      'petMedicalRecord.errors.bloodTest.invalidBloodTestIdFormat',
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

    const parsed = parseBody(ctx.body, updateBloodTestSchema);
    if (!parsed.ok) {
      return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
    }
    const data = parsed.data;

    if (data.bloodTestDate && !isValidDateFormat(data.bloodTestDate)) {
      return response.errorResponse(
        400,
        'petMedicalRecord.errors.bloodTest.invalidDateFormat',
        ctx.event
      );
    }

    const updateFields: Record<string, unknown> = {};
    if (data.bloodTestDate !== undefined) {
      updateFields.bloodTestDate = data.bloodTestDate
        ? parseDDMMYYYY(data.bloodTestDate)
        : null;
    }
    if (data.heartworm !== undefined) updateFields.heartworm = data.heartworm;
    if (data.lymeDisease !== undefined) updateFields.lymeDisease = data.lymeDisease;
    if (data.ehrlichiosis !== undefined) updateFields.ehrlichiosis = data.ehrlichiosis;
    if (data.anaplasmosis !== undefined) updateFields.anaplasmosis = data.anaplasmosis;
    if (data.babesiosis !== undefined) updateFields.babesiosis = data.babesiosis;

    const BloodTest = mongoose.model('blood_tests');
    const updated = await BloodTest.findOneAndUpdate(
      { _id: bloodTestId, petId },
      { $set: updateFields },
      { new: true, projection: PROJECTION }
    ).lean();

    if (!updated) {
      return response.errorResponse(
        404,
        'petMedicalRecord.errors.bloodTest.notFound',
        ctx.event
      );
    }

    return response.successResponse(200, ctx.event, {
      message: 'petMedicalRecord.success.bloodTest.updated',
      petId,
      bloodTestRecordId: bloodTestId,
      form: sanitizeRecord(updated as Record<string, unknown>),
    });
  } catch (error) {
    const known = handleKnownError(error, ctx.event);
    if (known) return known;
    throw error;
  }
}

export async function handleDeleteBloodTestRecord(
  ctx: RouteContext
): Promise<APIGatewayProxyResult> {
  const petId = String(ctx.event.pathParameters?.petId || '');
  const bloodTestId = String(ctx.event.pathParameters?.bloodTestId || '');

  const authContext = requireAuthContext(ctx.event);

  if (!mongoose.isValidObjectId(bloodTestId)) {
    return response.errorResponse(
      400,
      'petMedicalRecord.errors.bloodTest.invalidBloodTestIdFormat',
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

    const BloodTest = mongoose.model('blood_tests');

    const deleted = await BloodTest.deleteOne({ _id: bloodTestId, petId });
    if (deleted.deletedCount === 0) {
      return response.errorResponse(
        404,
        'petMedicalRecord.errors.bloodTest.notFound',
        ctx.event
      );
    }

    return response.successResponse(200, ctx.event, {
      message: 'petMedicalRecord.success.bloodTest.deleted',
      petId,
      bloodTestRecordId: bloodTestId,
    });
  } catch (error) {
    const known = handleKnownError(error, ctx.event);
    if (known) return known;
    throw error;
  }
}
