import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import multipart from 'lambda-multipart-parser';
import { parseBody, requireAuthContext } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { response } from '../utils/response';
import { applyRateLimit } from '../utils/rateLimit';
import { sanitizePetFound } from '../utils/sanitize';
import { parseFlexibleDate } from '../utils/date';
import { uploadImageFile, getNextSerialNumber } from '../utils/upload';
import { normalizeFoundMultipartBody, type ParsedMultipartForm } from '../utils/multipart';
import { createPetFoundSchema } from '../zodSchema/petFoundSchema';
import { connectToMongoDB } from '../config/db';

export async function handleListPetFound(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  requireAuthContext(ctx.event);
  await connectToMongoDB();

  const PetFound = mongoose.model('PetFound');
  const records = await PetFound.find({}).select('-__v').sort({ foundDate: -1 }).lean();

  return response.successResponse(200, ctx.event, {
    message: 'petRecovery.success.petFound.listRetrieved',
    count: records.length,
    pets: records.map(sanitizePetFound),
  });
}

export async function handleCreatePetFound(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);
  await connectToMongoDB();

  const rateLimitResponse = await applyRateLimit({
    action: 'petRecovery.petFound.create',
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
  const normalized = normalizeFoundMultipartBody(rawFields);
  const parsed = parseBody(normalized, createPetFoundSchema);
  if (!parsed.ok) {
    return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
  }

  const data = parsed.data;
  const foundDate = parseFlexibleDate(data.foundDate);
  if (!foundDate || isNaN(foundDate.getTime())) {
    return response.errorResponse(400, 'petRecovery.errors.petFound.foundDateRequired', ctx.event);
  }

  const PetFound = mongoose.model('PetFound');
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

  const record = await PetFound.create({
    _id: recordId,
    userId: authContext.userId,
    animal: data.animal,
    breed: data.breed,
    description: data.description,
    remarks: data.remarks,
    status: data.status,
    owner: data.owner,
    ownerContact1: data.ownerContact1 ?? null,
    foundDate,
    foundLocation: data.foundLocation,
    foundDistrict: data.foundDistrict,
    serial_number: serialNumber,
    breedimage: uploadedUrls,
  });

  return response.successResponse(201, ctx.event, {
    message: 'petRecovery.success.petFound.created',
    id: record._id,
  });
}

export async function handleDeletePetFound(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);
  const petFoundID = ctx.event.pathParameters?.petFoundID;

  if (!petFoundID || !mongoose.Types.ObjectId.isValid(petFoundID)) {
    return response.errorResponse(400, 'petRecovery.errors.petFound.invalidId', ctx.event);
  }

  await connectToMongoDB();

  const PetFound = mongoose.model('PetFound');
  const record = (await PetFound.findById(petFoundID)
    .select('userId')
    .lean()) as { userId?: unknown } | null;

  if (!record) {
    return response.errorResponse(404, 'petRecovery.errors.petFound.notFound', ctx.event);
  }

  if (String(record.userId) !== authContext.userId) {
    return response.errorResponse(403, 'common.forbidden', ctx.event);
  }

  await PetFound.deleteOne({ _id: petFoundID });

  return response.successResponse(200, ctx.event, {
    message: 'petRecovery.success.petFound.deleted',
  });
}
