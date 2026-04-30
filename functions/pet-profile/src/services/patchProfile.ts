import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import multipart from 'lambda-multipart-parser';
import { getFirstZodIssueMessage, requireAuthContext } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { buildOwnershipFilter, loadAuthorizedPet } from '../utils/auth';
import { parseFlexibleDate } from '../utils/date';
import { HttpError } from '../utils/httpError';
import { response } from '../utils/response';
import { applyRateLimit } from '../utils/rateLimit';
import { sanitizePetDetail } from '../utils/sanitize';
import { uploadImageFile } from '../utils/upload';
import { patchPetProfileBodySchema, patchPetProfileMultipartBodySchema } from '../zodSchema/patchPetProfileSchemas';

type PetDocument = {
  _id: { toString(): string } | string;
  userId?: unknown;
  ngoId?: string;
  ngoPetId?: string | null;
  breedimage?: string[];
  deleted?: boolean;
  [key: string]: unknown;
};

type MutablePetDocument = PetDocument & {
  save: (options?: Record<string, unknown>) => Promise<void>;
};

type ParsedMultipartForm = Record<string, unknown> & {
  files?: Array<{ content?: Buffer; filename?: string }>;
};

const patchMultipartAllowedFields = new Set([
  'removedIndices',
  'name',
  'animal',
  'birthday',
  'weight',
  'sex',
  'sterilization',
  'sterilizationDate',
  'adoptionStatus',
  'breed',
  'bloodType',
  'features',
  'info',
  'status',
  'owner',
  'tagId',
  'ownerContact1',
  'ownerContact2',
  'contact1Show',
  'contact2Show',
  'receivedDate',
  'ngoId',
  'ngoPetId',
]);

async function ensureUniqueTagForPatch(params: {
  tagId: string | undefined;
  petId: string;
}): Promise<void> {
  if (!params.tagId) {
    return;
  }

  const Pet = mongoose.model('Pet');
  const existingTag = await Pet.findOne({
    tagId: params.tagId,
    _id: { $ne: params.petId },
    deleted: { $ne: true },
  })
    .select('_id')
    .lean();

  if (existingTag) {
    throw new HttpError(409, 'petProfile.errors.duplicatePetTag');
  }
}

async function ensureUniqueNgoPetIdForPatch(params: {
  ngoPetId: string;
  petId: string;
}): Promise<void> {
  const Pet = mongoose.model('Pet');
  const existingPet = await Pet.findOne({
    ngoPetId: params.ngoPetId,
    _id: { $ne: params.petId },
    deleted: { $ne: true },
  }).lean();

  if (existingPet) {
    throw new HttpError(409, 'petProfile.errors.duplicateNgoPetId');
  }
}

function normalizeMultipartBoolean(value: unknown): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  return String(value).toLowerCase() === 'true';
}

function normalizeMultipartNumber(value: unknown): number | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }

  return Number(value);
}

function normalizeMultipartBody(rawFields: Record<string, unknown>): Record<string, unknown> {
  return {
    ...rawFields,
    weight: normalizeMultipartNumber(rawFields.weight),
    sterilization: normalizeMultipartBoolean(rawFields.sterilization),
    ownerContact1: normalizeMultipartNumber(rawFields.ownerContact1),
    ownerContact2: normalizeMultipartNumber(rawFields.ownerContact2),
    contact1Show: normalizeMultipartBoolean(rawFields.contact1Show),
    contact2Show: normalizeMultipartBoolean(rawFields.contact2Show),
    breedimage:
      typeof rawFields.breedimage === 'string' && rawFields.breedimage.trim()
        ? [rawFields.breedimage]
        : undefined,
  };
}

function parseRemovedIndices(rawValue: string | undefined): number[] {
  if (!rawValue) {
    return [];
  }

  let removedIndices: unknown;
  try {
    removedIndices = JSON.parse(rawValue);
  } catch {
    throw new HttpError(400, 'petProfile.errors.invalidRemovedIndices');
  }

  if (
    !Array.isArray(removedIndices) ||
    !removedIndices.every((index) => typeof index === 'number' && Number.isInteger(index))
  ) {
    throw new HttpError(400, 'petProfile.errors.invalidRemovedIndices');
  }

  return removedIndices;
}

function removeBreedImagesAtIndices(pet: MutablePetDocument, removedIndices: number[]) {
  if (removedIndices.length === 0) {
    return;
  }

  if (!Array.isArray(pet.breedimage)) {
    pet.breedimage = [];
  }

  const sortedIndices = [...removedIndices].sort((a, b) => b - a);
  for (const index of sortedIndices) {
    if (index >= 0 && index < pet.breedimage.length) {
      pet.breedimage.splice(index, 1);
    }
  }
}

function buildJsonPatchUpdateFields(data: ReturnType<typeof patchPetProfileBodySchema.parse>): Record<string, unknown> {
  const updateFields: Record<string, unknown> = {};

  if (data.name !== undefined) updateFields.name = data.name;
  if (data.breedimage !== undefined) updateFields.breedimage = data.breedimage;
  if (data.animal !== undefined) updateFields.animal = data.animal;
  if (data.birthday !== undefined) updateFields.birthday = parseFlexibleDate(data.birthday);
  if (data.weight !== undefined) updateFields.weight = data.weight;
  if (data.sex !== undefined) updateFields.sex = data.sex;
  if (data.sterilization !== undefined) updateFields.sterilization = data.sterilization;
  if (data.sterilizationDate !== undefined) updateFields.sterilizationDate = parseFlexibleDate(data.sterilizationDate);
  if (data.adoptionStatus !== undefined) updateFields.adoptionStatus = data.adoptionStatus;
  if (data.breed !== undefined) updateFields.breed = data.breed;
  if (data.bloodType !== undefined) updateFields.bloodType = data.bloodType;
  if (data.features !== undefined) updateFields.features = data.features;
  if (data.info !== undefined) updateFields.info = data.info;
  if (data.status !== undefined) updateFields.status = data.status;
  if (data.ownerContact1 !== undefined) updateFields.ownerContact1 = data.ownerContact1;
  if (data.ownerContact2 !== undefined) updateFields.ownerContact2 = data.ownerContact2;
  if (data.contact1Show !== undefined) updateFields.contact1Show = data.contact1Show;
  if (data.contact2Show !== undefined) updateFields.contact2Show = data.contact2Show;
  if (data.receivedDate !== undefined) updateFields.receivedDate = parseFlexibleDate(data.receivedDate);
  if (data.location !== undefined) updateFields.locationName = data.location;
  if (data.position !== undefined) updateFields.position = data.position;
  if (data.chipId !== undefined) updateFields.chipId = data.chipId;
  if (data.placeOfBirth !== undefined) updateFields.placeOfBirth = data.placeOfBirth;
  if (data.motherName !== undefined) updateFields.motherName = data.motherName;
  if (data.motherBreed !== undefined) updateFields.motherBreed = data.motherBreed;
  if (data.motherDOB !== undefined) updateFields.motherDOB = parseFlexibleDate(data.motherDOB);
  if (data.motherChip !== undefined) updateFields.motherChip = data.motherChip;
  if (data.motherPlaceOfBirth !== undefined) updateFields.motherPlaceOfBirth = data.motherPlaceOfBirth;
  if (data.motherParity !== undefined) updateFields.motherParity = data.motherParity;
  if (data.fatherName !== undefined) updateFields.fatherName = data.fatherName;
  if (data.fatherBreed !== undefined) updateFields.fatherBreed = data.fatherBreed;
  if (data.fatherDOB !== undefined) updateFields.fatherDOB = parseFlexibleDate(data.fatherDOB);
  if (data.fatherChip !== undefined) updateFields.fatherChip = data.fatherChip;
  if (data.fatherPlaceOfBirth !== undefined) updateFields.fatherPlaceOfBirth = data.fatherPlaceOfBirth;

  return updateFields;
}

function applyMultipartPatchScalarFields(
  pet: MutablePetDocument,
  data: ReturnType<typeof patchPetProfileMultipartBodySchema.parse>
): void {
  if (data.name !== undefined) pet.name = data.name;
  if (data.animal !== undefined) pet.animal = data.animal;
  if (data.birthday !== undefined) pet.birthday = parseFlexibleDate(data.birthday);
  if (data.weight !== undefined) pet.weight = data.weight;
  if (data.sex !== undefined) pet.sex = data.sex;
  if (data.sterilization !== undefined) pet.sterilization = data.sterilization;
  if (data.sterilizationDate !== undefined) pet.sterilizationDate = parseFlexibleDate(data.sterilizationDate);
  if (data.adoptionStatus !== undefined) pet.adoptionStatus = data.adoptionStatus;
  if (data.breed !== undefined) pet.breed = data.breed;
  if (data.bloodType !== undefined) pet.bloodType = data.bloodType;
  if (data.features !== undefined) pet.features = data.features;
  if (data.info !== undefined) pet.info = data.info;
  if (data.status !== undefined) pet.status = data.status;
  if (data.owner !== undefined) pet.owner = data.owner;
  if (data.ownerContact1 !== undefined) pet.ownerContact1 = data.ownerContact1;
  if (data.ownerContact2 !== undefined) pet.ownerContact2 = data.ownerContact2;
  if (data.contact1Show !== undefined) pet.contact1Show = data.contact1Show;
  if (data.contact2Show !== undefined) pet.contact2Show = data.contact2Show;
  if (data.receivedDate !== undefined) pet.receivedDate = parseFlexibleDate(data.receivedDate);
}

function handleKnownError(error: unknown, event: RouteContext['event']): APIGatewayProxyResult | null {
  if (error instanceof HttpError) {
    return response.errorResponse(error.statusCode, error.errorKey, event);
  }

  const key = error instanceof Error ? error.message : '';
  if (key.includes('.')) {
    const statusCode = (error as { statusCode?: number }).statusCode || 400;
    return response.errorResponse(statusCode, key, event);
  }

  return null;
}

export async function handlePatchPetProfile(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  requireAuthContext(ctx.event);
  await connectToMongoDB();

  const contentType = String(ctx.event.headers?.['content-type'] || ctx.event.headers?.['Content-Type'] || '').toLowerCase();
  if (contentType.includes('multipart/form-data')) {
    return handlePatchPetProfileMultipart(ctx);
  }

  const parsed = patchPetProfileBodySchema.safeParse(ctx.body);
  if (!parsed.success) {
    return response.errorResponse(400, getFirstZodIssueMessage(parsed.error), ctx.event);
  }

  try {
    await loadAuthorizedPet(ctx.event);
  } catch (error) {
    const knownError = handleKnownError(error, ctx.event);
    if (knownError) {
      return knownError;
    }
    throw error;
  }

  const Pet = mongoose.model('Pet');
  const petId = String(ctx.event.pathParameters?.petId || '');
  const updatedPet = (await Pet.findOneAndUpdate(
    buildOwnershipFilter(ctx.event, petId),
    { $set: buildJsonPatchUpdateFields(parsed.data) },
    { returnDocument: 'after', lean: true }
  )) as PetDocument | null;

  if (!updatedPet) {
    return response.errorResponse(404, 'petProfile.errors.petNotFound', ctx.event);
  }

  return response.successResponse(200, ctx.event, {
    message: 'petProfile.success.updated',
    form: sanitizePetDetail(updatedPet),
    id: updatedPet._id,
  });
}

export async function handlePatchPetProfileMultipart(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  try {
    const authContext = requireAuthContext(ctx.event);
    const petId = String(ctx.event.pathParameters?.petId || '');
    if (!mongoose.isValidObjectId(petId)) {
      return response.errorResponse(400, 'petProfile.errors.invalidPetId', ctx.event);
    }

    const rateLimitResponse = await applyRateLimit({
      action: 'petProfile.patch.multipart',
      event: ctx.event,
      identifier: authContext.userId,
      limit: 30,
      windowSeconds: 300,
    });
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const parsedForm = (await multipart.parse(ctx.event)) as ParsedMultipartForm;
    const { files, ...rawFields } = parsedForm;

    const unknownField = Object.keys(rawFields).find((key) => !patchMultipartAllowedFields.has(key));
    if (unknownField) {
      return response.errorResponse(400, 'petProfile.errors.invalidBodyParams', ctx.event);
    }

    const normalizedBody = normalizeMultipartBody(rawFields);
    const filteredBody = Object.fromEntries(
      Object.entries(normalizedBody).filter(([key]) => patchMultipartAllowedFields.has(key))
    );
    const parsed = patchPetProfileMultipartBodySchema.safeParse(filteredBody);

    if (!parsed.success) {
      return response.errorResponse(400, getFirstZodIssueMessage(parsed.error), ctx.event);
    }

    const pet = await loadAuthorizedPet(ctx.event, { petId, lean: false, notFoundKey: 'petProfile.errors.petNotFound' });
    const mutablePet = pet as MutablePetDocument;
    const isNgoOwner =
      authContext.userRole === 'ngo' &&
      Boolean(mutablePet.ngoId && authContext.ngoId && String(mutablePet.ngoId) === String(authContext.ngoId));

    removeBreedImagesAtIndices(mutablePet, parseRemovedIndices(parsed.data.removedIndices));

    if (Array.isArray(files) && files.length > 0) {
      if (!Array.isArray(mutablePet.breedimage)) {
        mutablePet.breedimage = [];
      }

      for (const file of files) {
        if (!file?.content) {
          continue;
        }

        const url = await uploadImageFile({
          buffer: file.content,
          folder: `user-uploads/pets/${mutablePet._id}`,
          originalname: file.filename,
        });
        mutablePet.breedimage.push(url);
      }
    }

    applyMultipartPatchScalarFields(mutablePet, parsed.data);

    if (parsed.data.tagId !== undefined) {
      await ensureUniqueTagForPatch({ tagId: parsed.data.tagId, petId });
      mutablePet.tagId = parsed.data.tagId;
    }

    if (parsed.data.ngoId !== undefined) {
      if (!isNgoOwner || String(authContext.ngoId) !== String(parsed.data.ngoId)) {
        return response.errorResponse(403, 'common.forbidden', ctx.event);
      }
      mutablePet.ngoId = parsed.data.ngoId;
    }

    if (parsed.data.ngoPetId !== undefined && parsed.data.ngoPetId !== mutablePet.ngoPetId) {
      if (!isNgoOwner) {
        return response.errorResponse(403, 'common.forbidden', ctx.event);
      }

      await ensureUniqueNgoPetIdForPatch({ ngoPetId: parsed.data.ngoPetId, petId });
      mutablePet.ngoPetId = parsed.data.ngoPetId;
    }

    await mutablePet.save({ validateBeforeSave: true });

    return response.successResponse(200, ctx.event, {
      message: 'petProfile.success.updated',
      id: mutablePet._id,
    });
  } catch (error) {
    const knownError = handleKnownError(error, ctx.event);
    if (knownError) {
      return knownError;
    }
    throw error;
  }
}
