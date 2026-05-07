import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { parseBody, parseMultipartBody, requireAuthContext } from '@aws-ddd-api/shared';
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

  const contentType = (
    ctx.event.headers?.['content-type'] ||
    ctx.event.headers?.['Content-Type'] ||
    ''
  ).toLowerCase();
  let files: Array<{ content?: Buffer; filename?: string }> = [];
  let parsedData: (typeof createPetBodySchema)['_output'];
  if (contentType.includes('multipart/form-data')) {
    const multiResult = await parseMultipartBody(ctx.event, createPetBodySchema, {
      normalize: normalizeMultipartBody,
    });
    if (!multiResult.ok) {
      return response.errorResponse(multiResult.statusCode, multiResult.errorKey, ctx.event);
    }
    files = multiResult.files;
    parsedData = multiResult.data;
  } else {
    const rawFields = (ctx.body as Record<string, unknown>) || {};
    const parseResult = parseBody(normalizeMultipartBody(rawFields), createPetBodySchema);
    if (!parseResult.ok) {
      return response.errorResponse(parseResult.statusCode, parseResult.errorKey, ctx.event);
    }
    parsedData = parseResult.data;
  }

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

      const url = await uploadImageFile({
        buffer: file.content,
        folder: `user-uploads/pets/${new mongoose.Types.ObjectId()}`,
        originalname: file.filename,
      });
      uploadedImageUrls.push(url);
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
    message: 'petProfile.success.created',
    id: pet._id,
    result: sanitizePetDetail(pet),
  });
}
