import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { parseMultipartBody, requireAuthContext } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { response } from '../utils/response';
import { applyRateLimit } from '../utils/rateLimit';
import { sanitizePetFound } from '../utils/sanitize';
import { parseFlexibleDate } from '../utils/date';
import { uploadImageFile, getNextSerialNumber } from '../utils/upload';
import { normalizeFoundMultipartBody } from '../utils/multipart';
import { createPetFoundSchema } from '../zodSchema/petFoundSchema';
import { connectToMongoDB } from '../config/db';

export async function handleListPetFound(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  requireAuthContext(ctx.event);
  await connectToMongoDB();

  const queryParams = ctx.event.queryStringParameters || {};
  const page = Math.max(1, parseInt(queryParams['page'] ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(queryParams['limit'] ?? '30', 10) || 30));
  const skip = (page - 1) * limit;

  const PetFound = mongoose.model('PetFound');
  const [records, total] = await Promise.all([
    PetFound.find({}).select('-__v').sort({ foundDate: -1 }).skip(skip).limit(limit).lean(),
    PetFound.countDocuments({}),
  ]);

  return response.successResponse(200, ctx.event, {
    message: 'success.retrieved',
    data: records.map(sanitizePetFound),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}

export async function handleCreatePetFound(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);

  const multiResult = await parseMultipartBody(ctx.event, createPetFoundSchema, {
    normalize: normalizeFoundMultipartBody,
  });
  if (!multiResult.ok) {
    return response.errorResponse(multiResult.statusCode, multiResult.errorKey, ctx.event);
  }
  const { data, files } = multiResult;

  await connectToMongoDB();

  const rateLimitResponse = await applyRateLimit({
    action: 'petRecovery.petFound.create',
    event: ctx.event,
    identifier: authContext.userId,
    limit: 5,
    windowSeconds: 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  const foundDate = parseFlexibleDate(data.foundDate);
  if (!foundDate || isNaN(foundDate.getTime())) {
    return response.errorResponse(400, 'petRecovery.errors.petFound.foundDateRequired', ctx.event);
  }

  const PetFound = mongoose.model('PetFound');
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
    message: 'success.created',
    data: { id: record._id },
  });
}

export async function handleDeletePetFound(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);
  const petFoundID = ctx.event.pathParameters?.petFoundID;

  if (!petFoundID || !mongoose.Types.ObjectId.isValid(petFoundID)) {
    return response.errorResponse(400, 'common.invalidObjectId', ctx.event);
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
    message: 'success.deleted',
  });
}
