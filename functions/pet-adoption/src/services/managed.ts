import type { APIGatewayProxyResult } from 'aws-lambda';
import type mongoose from 'mongoose';
import { AuthContextError, parseBody, requireAuthContext } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { connectMainDB } from '../config/db';
import { response } from '../utils/response';
import {
  authorizePetAccess,
  isValidObjectId,
  parseDateFlexible,
  sanitizeManagedAdoption,
  toErrorResponse,
  validateAdoptionDates,
} from '../utils/helpers';
import { adoptionCreateSchema, adoptionUpdateSchema } from '../zodSchema/adoptionSchema';

const ADOPTION_PROJECTION =
  '_id petId postAdoptionName isNeutered NeuteredDate firstVaccinationDate secondVaccinationDate thirdVaccinationDate followUpMonth1 followUpMonth2 followUpMonth3 followUpMonth4 followUpMonth5 followUpMonth6 followUpMonth7 followUpMonth8 followUpMonth9 followUpMonth10 followUpMonth11 followUpMonth12 createdAt updatedAt';

/**
 * GET /pet/adoption/{petId}/record
 * Returns the managed adoption/placement record linked to a pet.
 * Protected: requires valid auth context.
 */
export async function handleGetManagedRecord(
  ctx: RouteContext,
  petId: string
): Promise<APIGatewayProxyResult> {
  if (!isValidObjectId(petId)) {
    return response.errorResponse(400, 'petAdoption.errors.managed.invalidPetId', ctx.event);
  }

  try {
    const authContext = requireAuthContext(ctx.event);
    const mainConn = await connectMainDB();
    await authorizePetAccess(mainConn, petId, authContext);

    const AdoptionModel = mainConn.model('pet_adoptions');
    const record = await AdoptionModel.findOne({ petId })
      .select(ADOPTION_PROJECTION)
      .lean();

    if (!record) {
      return response.successResponse(200, ctx.event, {
        message: 'petAdoption.success.managed.retrieved',
        form: null,
        petId,
      });
    }

    const raw = record as Record<string, unknown>;
    return response.successResponse(200, ctx.event, {
      message: 'petAdoption.success.managed.retrieved',
      form: sanitizeManagedAdoption(record),
      petId,
      adoptionId: String(raw._id),
    });
  } catch (error) {
    const knownError = toErrorResponse(error, ctx.event);
    if (knownError) return knownError;
    throw error;
  }
}

/**
 * POST /pet/adoption/{petId}/record
 * Creates the managed adoption/placement record for a pet when one does not already exist.
 * Protected: requires valid auth context.
 */
export async function handleCreateManagedRecord(
  ctx: RouteContext,
  petId: string
): Promise<APIGatewayProxyResult> {
  if (!isValidObjectId(petId)) {
    return response.errorResponse(400, 'petAdoption.errors.managed.invalidPetId', ctx.event);
  }

  try {
    const authContext = requireAuthContext(ctx.event);

    const parsed = parseBody(ctx.body, adoptionCreateSchema);
    if (!parsed.ok) {
      return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
    }

    const data = parsed.data as Record<string, unknown>;

    const invalidDate = validateAdoptionDates(data);
    if (invalidDate) {
      return response.errorResponse(400, 'petAdoption.errors.managed.invalidDateFormat', ctx.event);
    }

    const mainConn = await connectMainDB();
    await authorizePetAccess(mainConn, petId, authContext);

    const AdoptionModel = mainConn.model('pet_adoptions');
    const existing = await AdoptionModel.findOne({ petId }).select('_id').lean();
    if (existing) {
      return response.errorResponse(409, 'petAdoption.errors.managed.duplicateRecord', ctx.event);
    }

    let newRecord: mongoose.Document & Record<string, unknown>;
    try {
      newRecord = (await AdoptionModel.create(
        buildAdoptionCreateDoc(petId, data)
      )) as typeof newRecord;
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        return response.errorResponse(
          409,
          'petAdoption.errors.managed.duplicateRecord',
          ctx.event
        );
      }
      throw error;
    }

    return response.successResponse(201, ctx.event, {
      message: 'petAdoption.success.managed.created',
      form: sanitizeManagedAdoption(newRecord),
      petId,
      adoptionId: String((newRecord as Record<string, unknown>)._id),
    });
  } catch (error) {
    const knownError = toErrorResponse(error, ctx.event);
    if (knownError) return knownError;
    throw error;
  }
}

/**
 * PATCH /pet/adoption/{id}
 * Updates the managed adoption/placement record for a pet.
 * Uses petId only — each pet has at most one adoption record.
 * Protected: requires valid auth context.
 */
export async function handleUpdateManagedRecord(
  ctx: RouteContext,
  petId: string
): Promise<APIGatewayProxyResult> {
  if (!isValidObjectId(petId)) {
    return response.errorResponse(400, 'petAdoption.errors.managed.invalidPetId', ctx.event);
  }

  try {
    const authContext = requireAuthContext(ctx.event);

    const parsed = parseBody(ctx.body, adoptionUpdateSchema);
    if (!parsed.ok) {
      return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
    }

    const data = parsed.data as Record<string, unknown>;

    const invalidDate = validateAdoptionDates(data);
    if (invalidDate) {
      return response.errorResponse(400, 'petAdoption.errors.managed.invalidDateFormat', ctx.event);
    }

    const updateFields = buildAdoptionUpdateFields(data);
    if (Object.keys(updateFields).length === 0) {
      return response.errorResponse(400, 'common.noFieldsToUpdate', ctx.event);
    }

    const mainConn = await connectMainDB();
    await authorizePetAccess(mainConn, petId, authContext);

    const AdoptionModel = mainConn.model('pet_adoptions');
    const result = await AdoptionModel.updateOne({ petId }, { $set: updateFields });

    if ((result as { matchedCount?: number }).matchedCount === 0) {
      return response.errorResponse(404, 'petAdoption.errors.managed.recordNotFound', ctx.event);
    }

    return response.successResponse(200, ctx.event, { message: 'petAdoption.success.managed.updated', petId });
  } catch (error) {
    const knownError = toErrorResponse(error, ctx.event);
    if (knownError) return knownError;
    throw error;
  }
}

/**
 * DELETE /pet/adoption/{id}
 * Deletes the managed adoption/placement record linked to a pet.
 * Uses petId only — each pet has at most one adoption record.
 * Protected: requires valid auth context.
 */
export async function handleDeleteManagedRecord(
  ctx: RouteContext,
  petId: string
): Promise<APIGatewayProxyResult> {
  if (!isValidObjectId(petId)) {
    return response.errorResponse(400, 'petAdoption.errors.managed.invalidPetId', ctx.event);
  }

  try {
    const authContext = requireAuthContext(ctx.event);
    const mainConn = await connectMainDB();
    await authorizePetAccess(mainConn, petId, authContext);

    const AdoptionModel = mainConn.model('pet_adoptions');
    const deleted = await AdoptionModel.deleteOne({ petId });

    if ((deleted as { deletedCount?: number }).deletedCount === 0) {
      return response.errorResponse(404, 'petAdoption.errors.managed.recordNotFound', ctx.event);
    }

    return response.successResponse(200, ctx.event, { message: 'petAdoption.success.managed.deleted', petId });
  } catch (error) {
    const knownError = toErrorResponse(error, ctx.event);
    if (knownError) return knownError;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function buildAdoptionCreateDoc(petId: string, data: Record<string, unknown>) {
  return {
    petId,
    postAdoptionName: (data.postAdoptionName as string | null | undefined) ?? null,
    isNeutered: data.isNeutered !== undefined ? data.isNeutered : null,
    NeuteredDate: data.NeuteredDate
      ? parseDateFlexible(data.NeuteredDate as string)
      : null,
    firstVaccinationDate: data.firstVaccinationDate
      ? parseDateFlexible(data.firstVaccinationDate as string)
      : null,
    secondVaccinationDate: data.secondVaccinationDate
      ? parseDateFlexible(data.secondVaccinationDate as string)
      : null,
    thirdVaccinationDate: data.thirdVaccinationDate
      ? parseDateFlexible(data.thirdVaccinationDate as string)
      : null,
    ...buildFollowUpFields(data, false),
  };
}

function buildAdoptionUpdateFields(data: Record<string, unknown>) {
  const fields: Record<string, unknown> = {};

  if (data.postAdoptionName !== undefined) fields.postAdoptionName = data.postAdoptionName;
  if (data.isNeutered !== undefined) fields.isNeutered = data.isNeutered;
  if (data.NeuteredDate !== undefined)
    fields.NeuteredDate = data.NeuteredDate
      ? parseDateFlexible(data.NeuteredDate as string)
      : null;
  if (data.firstVaccinationDate !== undefined)
    fields.firstVaccinationDate = data.firstVaccinationDate
      ? parseDateFlexible(data.firstVaccinationDate as string)
      : null;
  if (data.secondVaccinationDate !== undefined)
    fields.secondVaccinationDate = data.secondVaccinationDate
      ? parseDateFlexible(data.secondVaccinationDate as string)
      : null;
  if (data.thirdVaccinationDate !== undefined)
    fields.thirdVaccinationDate = data.thirdVaccinationDate
      ? parseDateFlexible(data.thirdVaccinationDate as string)
      : null;

  Object.assign(fields, buildFollowUpFields(data, true));

  return fields;
}

function buildFollowUpFields(data: Record<string, unknown>, partialUpdate: boolean) {
  const fields: Record<string, boolean> = {};
  for (let i = 1; i <= 12; i++) {
    const key = `followUpMonth${i}`;
    if (partialUpdate) {
      if (data[key] !== undefined) fields[key] = Boolean(data[key]);
    } else {
      fields[key] = Boolean(data[key]);
    }
  }
  return fields;
}
