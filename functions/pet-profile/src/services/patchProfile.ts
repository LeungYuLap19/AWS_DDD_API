import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { parseMultipartBody, requireAuthContext } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { loadAuthorizedPet } from '../utils/auth';
import { normalizeMultipartBody } from '../utils/multipart';
import { response } from '../utils/response';
import { applyRateLimit } from '../utils/rateLimit';
import { uploadImageFile } from '../utils/upload';
import { patchPetAllowedFields, patchPetBodySchema } from '../zodSchema/patchPetProfileSchemas';
import { ensureUniqueNgoPetId, ensureUniqueTag } from './profileHelpers';
import {
  applyPatchScalarFields,
  parseRemovedIndices,
  removeBreedImagesAtIndices,
} from './patchHelpers';
import type { MutablePetDocument } from './patchHelpers';

export async function handlePatchPetProfile(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);

  const petId = String(ctx.event.pathParameters?.petId || '');
  if (!mongoose.isValidObjectId(petId)) {
    return response.errorResponse(400, 'common.invalidObjectId', ctx.event);
  }

  const multiResult = await parseMultipartBody(ctx.event, patchPetBodySchema, {
    validate: (rawFields) => {
      const unknownField = Object.keys(rawFields).find((key) => !patchPetAllowedFields.has(key));
      return unknownField ? 'common.invalidBodyParams' : null;
    },
    normalize: (rawFields) =>
      Object.fromEntries(
        Object.entries(normalizeMultipartBody(rawFields)).filter(([key]) => patchPetAllowedFields.has(key))
      ),
  });
  if (!multiResult.ok) {
    return response.errorResponse(multiResult.statusCode, multiResult.errorKey, ctx.event);
  }
  const { files, data: parsedData } = multiResult;

  await connectToMongoDB();

  const rateLimitResponse = await applyRateLimit({
    action: 'petProfile.patch',
    event: ctx.event,
    identifier: authContext.userId,
    limit: 30,
    windowSeconds: 300,
  });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const pet = await loadAuthorizedPet(ctx.event, { petId, lean: false, notFoundKey: 'petProfile.errors.petNotFound' });
  const mutablePet = pet as MutablePetDocument;
  const isNgoOwner =
    authContext.userRole === 'ngo' &&
    Boolean(mutablePet.ngoId && authContext.ngoId && String(mutablePet.ngoId) === String(authContext.ngoId));

  removeBreedImagesAtIndices(mutablePet, parseRemovedIndices(parsedData.removedIndices));

  if (Array.isArray(files) && files.length > 0) {
    if (!Array.isArray(mutablePet.breedimage)) {
      mutablePet.breedimage = [];
    }

    for (const file of files) {
      if (!file?.content) {
        continue;
      }

      try {
        const url = await uploadImageFile(
          { buffer: file.content, originalname: file.filename ?? '' },
          `user-uploads/pets/${mutablePet._id}`
        );
        mutablePet.breedimage.push(url);
      } catch (err: unknown) {
        const code = (err as { code?: string }).code;
        if (code === 'INVALID_FILE_TYPE') return response.errorResponse(400, 'petProfile.errors.invalidFileType', ctx.event);
        if (code === 'FILE_TOO_LARGE') return response.errorResponse(413, 'petProfile.errors.fileTooLarge', ctx.event);
        throw err;
      }
    }
  }

  applyPatchScalarFields(mutablePet, parsedData);

  if (parsedData.tagId !== undefined) {
    await ensureUniqueTag(parsedData.tagId, petId);
    mutablePet.tagId = parsedData.tagId;
  }

  if (parsedData.ngoId !== undefined) {
    if (!isNgoOwner || String(authContext.ngoId) !== String(parsedData.ngoId)) {
      return response.errorResponse(403, 'common.forbidden', ctx.event);
    }
    mutablePet.ngoId = parsedData.ngoId;
  }

  if (parsedData.ngoPetId !== undefined && parsedData.ngoPetId !== mutablePet.ngoPetId) {
    if (!isNgoOwner) {
      return response.errorResponse(403, 'common.forbidden', ctx.event);
    }
    await ensureUniqueNgoPetId(parsedData.ngoPetId, petId);
    mutablePet.ngoPetId = parsedData.ngoPetId;
  }

  await mutablePet.save({ validateBeforeSave: true });

  return response.successResponse(200, ctx.event, {
    message: 'success.updated',
  });
}
