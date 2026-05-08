import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { parseMultipartBody, requireAuthContext } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { parseFlexibleDate } from '../utils/date';
import { normalizeMultipartBody } from '../utils/multipart';
import { response } from '../utils/response';
import { applyRateLimit } from '../utils/rateLimit';
import { sanitizePetDetail } from '../utils/sanitize';
import { uploadImageFile } from '../utils/upload';
import { createPetBodySchema } from '../zodSchema/createPetSchemas';
import {
  buildTransferNgoSeed,
  ensureUniqueNgoPetId,
  ensureUniqueTag,
  maybeGenerateNgoPetId,
  resolveActiveUser,
} from './profileHelpers';

export async function handleCreatePetProfile(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);

  const multiResult = await parseMultipartBody(ctx.event, createPetBodySchema, {
    normalize: normalizeMultipartBody,
  });
  if (!multiResult.ok) {
    return response.errorResponse(multiResult.statusCode, multiResult.errorKey, ctx.event);
  }
  const { files, data: parsedData } = multiResult;

  await connectToMongoDB();

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

  if (parsedData.tagId) {
    await ensureUniqueTag(parsedData.tagId);
  }

  const ngoId = parsedData.ngoId;
  const ngoPetId = await maybeGenerateNgoPetId({ authContext, ngoId });
  await ensureUniqueNgoPetId(ngoPetId);

  const uploadedImageUrls: string[] = [];
  if (Array.isArray(files)) {
    for (const file of files) {
      if (!file?.content) {
        continue;
      }

      try {
        const url = await uploadImageFile(
          { buffer: file.content, originalname: file.filename ?? '' },
          `user-uploads/pets/${new mongoose.Types.ObjectId()}`
        );
        uploadedImageUrls.push(url);
      } catch (err: unknown) {
        const code = (err as { code?: string }).code;
        if (code === 'INVALID_FILE_TYPE') return response.errorResponse(400, 'petProfile.errors.invalidFileType', ctx.event);
        if (code === 'FILE_TOO_LARGE') return response.errorResponse(413, 'petProfile.errors.fileTooLarge', ctx.event);
        throw err;
      }
    }
  }

  if (uploadedImageUrls.length === 0 && parsedData.breedimage?.length) {
    uploadedImageUrls.push(...parsedData.breedimage);
  }

  const Pet = mongoose.model('Pet');
  const pet = await Pet.create({
    userId: user._id,
    name: parsedData.name,
    birthday: parsedData.birthday ? parseFlexibleDate(parsedData.birthday) : null,
    weight: parsedData.weight,
    sex: parsedData.sex,
    sterilization: parsedData.sterilization,
    sterilizationDate: parsedData.sterilizationDate ? parseFlexibleDate(parsedData.sterilizationDate) : null,
    adoptionStatus: parsedData.adoptionStatus,
    animal: parsedData.animal,
    breed: parsedData.breed,
    bloodType: parsedData.bloodType,
    features: parsedData.features,
    info: parsedData.info,
    status: parsedData.status,
    owner: parsedData.owner,
    ngoId: authContext.userRole === 'ngo' && authContext.ngoId ? ngoId : undefined,
    ngoPetId,
    ownerContact1: parsedData.ownerContact1,
    ownerContact2: parsedData.ownerContact2,
    contact1Show: parsedData.contact1Show,
    contact2Show: parsedData.contact2Show,
    receivedDate: parsedData.receivedDate ? parseFlexibleDate(parsedData.receivedDate) : null,
    breedimage: uploadedImageUrls,
    locationName: parsedData.location,
    position: parsedData.position,
    tagId: parsedData.tagId,
    transferNGO: buildTransferNgoSeed(),
  });

  return response.successResponse(201, ctx.event, {
    message: 'success.created',
    data: { id: pet._id, ...sanitizePetDetail(pet) },
  });
}
