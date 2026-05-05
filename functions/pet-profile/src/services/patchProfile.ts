import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import multipart from 'lambda-multipart-parser';
import { parseBody, requireAuthContext } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { loadAuthorizedPet } from '../utils/auth';
import { normalizeMultipartBody } from '../utils/multipart';
import type { ParsedMultipartForm } from '../utils/multipart';
import { response } from '../utils/response';
import { applyRateLimit } from '../utils/rateLimit';
import { uploadImageFile } from '../utils/upload';
import { patchPetAllowedFields, patchPetBodySchema } from '../zodSchema/patchPetProfileSchemas';
import { ensureUniqueNgoPetId, ensureUniqueTag, handleKnownError } from './profileHelpers';
import {
  applyPatchScalarFields,
  parseRemovedIndices,
  removeBreedImagesAtIndices,
} from './patchHelpers';
import type { MutablePetDocument } from './patchHelpers';

export async function handlePatchPetProfile(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);
  await connectToMongoDB();

  try {
    const petId = String(ctx.event.pathParameters?.petId || '');
    if (!mongoose.isValidObjectId(petId)) {
      return response.errorResponse(400, 'petProfile.errors.invalidPetId', ctx.event);
    }

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

    const contentType = (
      ctx.event.headers?.['content-type'] ||
      ctx.event.headers?.['Content-Type'] ||
      ''
    ).toLowerCase();
    const isMultipart = contentType.includes('multipart/form-data');
    let files: ParsedMultipartForm['files'] = [];
    let rawFields: Record<string, unknown>;
    if (isMultipart) {
      const parsedForm = (await multipart.parse(ctx.event)) as ParsedMultipartForm;
      files = parsedForm.files || [];
      const { files: _f, ...fields } = parsedForm;
      rawFields = fields;
    } else {
      rawFields = (ctx.body as Record<string, unknown>) || {};
    }

    const unknownField = Object.keys(rawFields).find((key) => !patchPetAllowedFields.has(key));
    if (unknownField) {
      return response.errorResponse(400, 'petProfile.errors.invalidBodyParams', ctx.event);
    }

    // For multipart, normalize string field values (booleans, numbers as strings).
    // For JSON, skip normalization so Zod receives proper native types.
    const sourceBody = isMultipart ? normalizeMultipartBody(rawFields) : rawFields;
    const filteredBody = Object.fromEntries(
      Object.entries(sourceBody).filter(([key]) => patchPetAllowedFields.has(key))
    );
    const parsed = parseBody(filteredBody, patchPetBodySchema);

    if (!parsed.ok) {
      return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
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

    applyPatchScalarFields(mutablePet, parsed.data);

    if (parsed.data.tagId !== undefined) {
      await ensureUniqueTag(parsed.data.tagId, petId);
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
      await ensureUniqueNgoPetId(parsed.data.ngoPetId, petId);
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
