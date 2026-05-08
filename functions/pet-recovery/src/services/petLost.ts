import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { parseMultipartBody, requireAuthContext } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { response } from '../utils/response';
import { applyRateLimit } from '../utils/rateLimit';
import { sanitizePetLost } from '../utils/sanitize';
import { parseFlexibleDate } from '../utils/date';
import { uploadImageFile, getNextSerialNumber } from '../utils/upload';
import { normalizeLostMultipartBody } from '../utils/multipart';
import { createPetLostSchema } from '../zodSchema/petLostSchema';
import { connectToMongoDB } from '../config/db';

type PetOwnershipRecord = { _id: unknown; userId?: unknown };

export async function handleListPetLost(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  requireAuthContext(ctx.event);
  await connectToMongoDB();

  const queryParams = ctx.event.queryStringParameters || {};
  const page = Math.max(1, parseInt(queryParams['page'] ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(queryParams['limit'] ?? '30', 10) || 30));
  const skip = (page - 1) * limit;

  const PetLost = mongoose.model('PetLost');
  const [records, total] = await Promise.all([
    PetLost.find({}).select('-__v').sort({ lostDate: -1 }).skip(skip).limit(limit).lean(),
    PetLost.countDocuments({}),
  ]);

  return response.successResponse(200, ctx.event, {
    message: 'success.retrieved',
    data: records.map(sanitizePetLost),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}

export async function handleCreatePetLost(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);

  const multiResult = await parseMultipartBody(ctx.event, createPetLostSchema, {
    normalize: normalizeLostMultipartBody,
  });
  if (!multiResult.ok) {
    return response.errorResponse(multiResult.statusCode, multiResult.errorKey, ctx.event);
  }
  const { data, files } = multiResult;

  await connectToMongoDB();

  const rateLimitResponse = await applyRateLimit({
    action: 'petRecovery.petLost.create',
    event: ctx.event,
    identifier: authContext.userId,
    limit: 5,
    windowSeconds: 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  const lostDate = parseFlexibleDate(data.lostDate);
  if (!lostDate || isNaN(lostDate.getTime())) {
    return response.errorResponse(400, 'petRecovery.errors.petLost.lostDateRequired', ctx.event);
  }

  if (data.petId) {
    const Pet = mongoose.model('Pet');
    const pet = (await Pet.findOne({ _id: data.petId, deleted: false })
      .select('userId')
      .lean()) as PetOwnershipRecord | null;

    if (!pet) {
      return response.errorResponse(404, 'petRecovery.errors.petLost.petNotFound', ctx.event);
    }

    if (String(pet.userId) !== authContext.userId) {
      return response.errorResponse(403, 'common.forbidden', ctx.event);
    }

    if (data.status) {
      await Pet.updateOne({ _id: data.petId }, { $set: { status: data.status } });
    }
  }

  const PetLost = mongoose.model('PetLost');
  const recordId = new mongoose.Types.ObjectId();
  const serialNumber = await getNextSerialNumber();

  const uploadedUrls: string[] = [];
  for (const file of files ?? []) {
    if (!file?.content) continue;
    try {
      const url = await uploadImageFile(
        { buffer: file.content, originalname: file.filename ?? '' },
        `user-uploads/pets/${recordId}`
      );
      uploadedUrls.push(url);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'INVALID_FILE_TYPE') return response.errorResponse(400, 'petRecovery.errors.invalidFileType', ctx.event);
      if (code === 'FILE_TOO_LARGE') return response.errorResponse(413, 'petRecovery.errors.fileTooLarge', ctx.event);
      throw err;
    }
  }

  const record = await PetLost.create({
    _id: recordId,
    userId: authContext.userId,
    petId: data.petId || null,
    name: data.name,
    birthday: data.birthday ? parseFlexibleDate(data.birthday) : null,
    weight: data.weight ?? null,
    sex: data.sex,
    sterilization: data.sterilization ?? null,
    animal: data.animal,
    breed: data.breed,
    description: data.description,
    remarks: data.remarks,
    status: data.status,
    owner: data.owner,
    ownerContact1: data.ownerContact1 ?? null,
    lostDate,
    lostLocation: data.lostLocation,
    lostDistrict: data.lostDistrict,
    serial_number: serialNumber,
    breedimage: uploadedUrls,
  });

  return response.successResponse(201, ctx.event, {
    message: 'success.created',
    data: { id: record._id },
  });
}

export async function handleDeletePetLost(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);
  const petLostID = ctx.event.pathParameters?.petLostID;

  if (!petLostID || !mongoose.Types.ObjectId.isValid(petLostID)) {
    return response.errorResponse(400, 'common.invalidObjectId', ctx.event);
  }

  await connectToMongoDB();

  const PetLost = mongoose.model('PetLost');
  const record = (await PetLost.findById(petLostID)
    .select('userId')
    .lean()) as { userId?: unknown } | null;

  if (!record) {
    return response.errorResponse(404, 'petRecovery.errors.petLost.notFound', ctx.event);
  }

  if (String(record.userId) !== authContext.userId) {
    return response.errorResponse(403, 'common.forbidden', ctx.event);
  }

  await PetLost.deleteOne({ _id: petLostID });

  return response.successResponse(200, ctx.event, {
    message: 'success.deleted',
  });
}
