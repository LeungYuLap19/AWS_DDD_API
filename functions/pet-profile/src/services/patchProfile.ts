import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { parseBody, parseMultipartBody, requireAuthContext } from '@aws-ddd-api/shared';
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
    return response.errorResponse(400, 'petProfile.errors.invalidPetId', ctx.event);
  }

  const contentType = (
    ctx.event.headers?.['content-type'] ||
    ctx.event.headers?.['Content-Type'] ||
    ''
  ).toLowerCase();
  const isMultipart = contentType.includes('multipart/form-data');
  let files: Array<{ content?: Buffer; filename?: string }> = [];
  let parsedData: (typeof patchPetBodySchema)['_output'];
  if (isMultipart) {
    const multiResult = await parseMultipartBody(ctx.event, patchPetBodySchema, {
      validate: (rawFields) => {
        const unknownField = Object.keys(rawFields).find((key) => !patchPetAllowedFields.has(key));
        return unknownField ? 'petProfile.errors.invalidBodyParams' : null;
      },
      normalize: (rawFields) =>
        Object.fromEntries(
          Object.entries(normalizeMultipartBody(rawFields)).filter(([key]) => patchPetAllowedFields.has(key))
        ),
    });
    if (!multiResult.ok) {
      return response.errorResponse(multiResult.statusCode, multiResult.errorKey, ctx.event);
    }
    files = multiResult.files;
    parsedData = multiResult.data;
  } else {
    const rawFields = (ctx.body as Record<string, unknown>) || {};
    const unknownField = Object.keys(rawFields).find((key) => !patchPetAllowedFields.has(key));
    if (unknownField) {
      return response.errorResponse(400, 'petProfile.errors.invalidBodyParams', ctx.event);
    }
    const filteredBody = Object.fromEntries(
      Object.entries(rawFields).filter(([key]) => patchPetAllowedFields.has(key))
    );
    const parseResult = parseBody(filteredBody, patchPetBodySchema);
    if (!parseResult.ok) {
      return response.errorResponse(parseResult.statusCode, parseResult.errorKey, ctx.event);
    }
    parsedData = parseResult.data;
  }

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

      const url = await uploadImageFile({
        buffer: file.content,
        folder: `user-uploads/pets/${mutablePet._id}`,
        originalname: file.filename,
      });
      mutablePet.breedimage.push(url);
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
    message: 'petProfile.success.updated',
    id: mutablePet._id,
  });
}
