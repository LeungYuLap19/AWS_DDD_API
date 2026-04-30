import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import multipart from 'lambda-multipart-parser';
import { getFirstZodIssueMessage, requireAuthContext } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { parseFlexibleDate } from '../utils/date';
import { HttpError } from '../utils/httpError';
import { response } from '../utils/response';
import { applyRateLimit } from '../utils/rateLimit';
import { sanitizePetDetail } from '../utils/sanitize';
import { uploadImageFile } from '../utils/upload';
import { createPetBodySchema, createPetMultipartBodySchema } from '../zodSchema/createPetSchemas';

type UserDocument = {
  _id: { toString(): string } | string;
  deleted?: boolean;
};

type ParsedMultipartForm = Record<string, unknown> & {
  files?: Array<{ content?: Buffer; filename?: string }>;
};

function buildTransferNgoSeed() {
  return [
    {
      regDate: null,
      regPlace: null,
      transferOwner: null,
      UserContact: null,
      UserEmail: null,
      transferContact: null,
      transferRemark: null,
      isTransferred: false,
    },
  ];
}

async function resolveActiveUser(userId: string): Promise<UserDocument | null> {
  const User = mongoose.model('User');
  return (await User.findOne({
    _id: userId,
    deleted: { $ne: true },
  }).lean()) as UserDocument | null;
}

async function ensureUniqueTag(tagId: string | undefined): Promise<void> {
  if (!tagId) {
    return;
  }

  const Pet = mongoose.model('Pet');
  const existingTag = await Pet.findOne({
    tagId,
    deleted: { $ne: true },
  })
    .select('_id')
    .lean();

  if (existingTag) {
    throw new HttpError(409, 'petProfile.errors.duplicatePetTag');
  }
}

async function maybeGenerateNgoPetId(params: {
  authContext: ReturnType<typeof requireAuthContext>;
  ngoId?: string;
}): Promise<string> {
  if (!params.ngoId) {
    return '';
  }

  if (params.authContext.userRole !== 'ngo') {
    throw new HttpError(403, 'petProfile.errors.ngoRoleRequired');
  }

  if (!params.authContext.ngoId) {
    throw new HttpError(403, 'petProfile.errors.ngoIdClaimRequired');
  }

  if (String(params.authContext.ngoId) !== String(params.ngoId)) {
    throw new HttpError(403, 'common.forbidden');
  }

  const NgoCounters = mongoose.model('NgoCounters');
  const counter = await NgoCounters.findOneAndUpdate(
    { ngoId: params.ngoId },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );

  const counterDoc = counter as { seq?: number; ngoPrefix?: string } | null;
  const prefix = counterDoc?.ngoPrefix || '';
  const suffix = String(counterDoc?.seq || 1).padStart(5, '0');
  return `${prefix}${suffix}`;
}

async function ensureUniqueNgoPetId(ngoPetId: string): Promise<void> {
  if (!ngoPetId) {
    return;
  }

  const Pet = mongoose.model('Pet');
  const existingPet = await Pet.findOne({ ngoPetId, deleted: { $ne: true } }).lean();
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

async function createPetFromMultipart(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);
  const rateLimitResponse = await applyRateLimit({
    action: 'petProfile.create.multipart',
    event: ctx.event,
    identifier: authContext.userId,
    limit: 20,
    windowSeconds: 300,
  });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const parsedForm = (await multipart.parse(ctx.event)) as ParsedMultipartForm;
  const { files, ...rawFields } = parsedForm;

  const normalizedBody = normalizeMultipartBody(rawFields);
  const parsed = createPetMultipartBodySchema.safeParse(normalizedBody);

  if (!parsed.success) {
    return response.errorResponse(400, getFirstZodIssueMessage(parsed.error), ctx.event);
  }

  const user = await resolveActiveUser(authContext.userId);
  if (!user) {
    return response.errorResponse(404, 'petProfile.errors.userNotFound', ctx.event);
  }

  const ngoId = parsed.data.ngoId;
  const ngoPetId = await maybeGenerateNgoPetId({ authContext, ngoId });
  await ensureUniqueNgoPetId(ngoPetId);

  const uploadedImageUrls: string[] = [];
  if (Array.isArray(files)) {
    for (const file of files) {
      if (!file?.content) {
        continue;
      }

      const url = await uploadImageFile({
        buffer: file.content,
        folder: `user-uploads/pets/${new mongoose.Types.ObjectId()}`,
        originalname: file.filename,
      });
      uploadedImageUrls.push(url);
    }
  }

  if (uploadedImageUrls.length === 0 && parsed.data.breedimage?.length) {
    uploadedImageUrls.push(...parsed.data.breedimage);
  }

  const Pet = mongoose.model('Pet');
  const pet = await Pet.create({
    userId: user._id,
    name: parsed.data.name,
    birthday: parsed.data.birthday ? parseFlexibleDate(parsed.data.birthday) : null,
    weight: parsed.data.weight,
    sex: parsed.data.sex,
    sterilization: parsed.data.sterilization,
    sterilizationDate: parsed.data.sterilizationDate ? parseFlexibleDate(parsed.data.sterilizationDate) : null,
    adoptionStatus: parsed.data.adoptionStatus,
    animal: parsed.data.animal,
    breed: parsed.data.breed,
    bloodType: parsed.data.bloodType,
    features: parsed.data.features,
    info: parsed.data.info,
    status: parsed.data.status,
    owner: parsed.data.owner,
    ngoId: authContext.userRole === 'ngo' && authContext.ngoId ? ngoId : undefined,
    ngoPetId,
    ownerContact1: parsed.data.ownerContact1,
    ownerContact2: parsed.data.ownerContact2,
    contact1Show: parsed.data.contact1Show,
    contact2Show: parsed.data.contact2Show,
    receivedDate: parsed.data.receivedDate ? parseFlexibleDate(parsed.data.receivedDate) : null,
    breedimage: uploadedImageUrls,
    locationName: parsed.data.location,
    position: parsed.data.position,
  });

  return response.successResponse(201, ctx.event, {
    message: 'petProfile.success.created',
    id: pet._id,
  });
}

export async function handleCreatePetProfile(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  requireAuthContext(ctx.event);
  await connectToMongoDB();

  const contentType = String(ctx.event.headers?.['content-type'] || ctx.event.headers?.['Content-Type'] || '').toLowerCase();
  if (contentType.includes('multipart/form-data')) {
    try {
      return await createPetFromMultipart(ctx);
    } catch (error) {
      const knownError = handleKnownError(error, ctx.event);
      if (knownError) {
        return knownError;
      }
      throw error;
    }
  }

  const parsed = createPetBodySchema.safeParse(ctx.body);
  if (!parsed.success) {
    return response.errorResponse(400, getFirstZodIssueMessage(parsed.error), ctx.event);
  }

  const authContext = requireAuthContext(ctx.event);
  const rateLimitResponse = await applyRateLimit({
    action: 'petProfile.create',
    event: ctx.event,
    identifier: authContext.userId,
    limit: 20,
    windowSeconds: 300,
  });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const user = await resolveActiveUser(authContext.userId);
  if (!user) {
    return response.errorResponse(404, 'petProfile.errors.userNotFound', ctx.event);
  }

  try {
    await ensureUniqueTag(parsed.data.tagId);
  } catch (error) {
    const knownError = handleKnownError(error, ctx.event);
    if (knownError) {
      return knownError;
    }
    throw error;
  }

  const Pet = mongoose.model('Pet');
  const pet = await Pet.create({
    userId: user._id,
    name: parsed.data.name,
    birthday: parseFlexibleDate(parsed.data.birthday),
    weight: parsed.data.weight,
    sex: parsed.data.sex,
    sterilization: parsed.data.sterilization,
    animal: parsed.data.animal,
    breed: parsed.data.breed,
    features: parsed.data.features,
    info: parsed.data.info,
    status: parsed.data.status,
    breedimage: parsed.data.breedimage || [],
    tagId: parsed.data.tagId,
    receivedDate: parsed.data.receivedDate ? parseFlexibleDate(parsed.data.receivedDate) : null,
    transferNGO: buildTransferNgoSeed(),
  });

  return response.successResponse(201, ctx.event, {
    message: 'petProfile.success.created',
    id: pet._id,
    result: sanitizePetDetail(pet),
  });
}
