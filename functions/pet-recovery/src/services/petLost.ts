import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import multipart from 'lambda-multipart-parser';
import { parseBody, requireAuthContext } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { response } from '../utils/response';
import { applyRateLimit } from '../utils/rateLimit';
import { sanitizePetLost } from '../utils/sanitize';
import { parseFlexibleDate } from '../utils/date';
import { uploadImageFile, getNextSerialNumber } from '../utils/upload';
import { normalizeLostMultipartBody, type ParsedMultipartForm } from '../utils/multipart';
import { createPetLostSchema } from '../zodSchema/petLostSchema';
import { connectToMongoDB } from '../config/db';

type PetOwnershipRecord = { _id: unknown; userId?: unknown };

export async function handleListPetLost(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  requireAuthContext(ctx.event);
  await connectToMongoDB();

  const PetLost = mongoose.model('PetLost');
  const records = await PetLost.find({}).select('-__v').sort({ lostDate: -1 }).lean();

  return response.successResponse(200, ctx.event, {
    message: 'petRecovery.success.petLost.listRetrieved',
    count: records.length,
    pets: records.map(sanitizePetLost),
  });
}

export async function handleCreatePetLost(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);
  await connectToMongoDB();

  const rateLimitResponse = await applyRateLimit({
    action: 'petRecovery.petLost.create',
    event: ctx.event,
    identifier: authContext.userId,
    limit: 5,
    windowSeconds: 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  let form: ParsedMultipartForm;
  try {
    form = (await multipart.parse(ctx.event)) as ParsedMultipartForm;
  } catch {
    return response.errorResponse(400, 'common.invalidBodyParams', ctx.event);
  }

  const { files, ...rawFields } = form;
  const normalized = normalizeLostMultipartBody(rawFields);
  const parsed = parseBody(normalized, createPetLostSchema);
  if (!parsed.ok) {
    return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
  }

  const data = parsed.data;
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

  const uploadedUrls: string[] = [];
  const [serialNumber] = await Promise.all([
    getNextSerialNumber(),
    (async () => {
      if (!Array.isArray(files) || files.length === 0) return;
      for (const file of files) {
        if (!file?.content) continue;
        const url = await uploadImageFile({
          buffer: file.content,
          folder: `user-uploads/pets/${recordId}`,
          originalname: file.filename,
        });
        if (url) uploadedUrls.push(url);
      }
    })(),
  ]);

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
    message: 'petRecovery.success.petLost.created',
    id: record._id,
  });
}

export async function handleDeletePetLost(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);
  const petLostID = ctx.event.pathParameters?.petLostID;

  if (!petLostID || !mongoose.Types.ObjectId.isValid(petLostID)) {
    return response.errorResponse(400, 'petRecovery.errors.petLost.invalidId', ctx.event);
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
    message: 'petRecovery.success.petLost.deleted',
  });
}
