import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import multipart from 'lambda-multipart-parser';
import { parseBody, requireAuthContext } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { parseFlexibleDate } from '../utils/date';
import { normalizeMultipartBody } from '../utils/multipart';
import type { ParsedMultipartForm } from '../utils/multipart';
import { response } from '../utils/response';
import { applyRateLimit } from '../utils/rateLimit';
import { sanitizePetDetail } from '../utils/sanitize';
import { uploadImageFile } from '../utils/upload';
import { createPetBodySchema } from '../zodSchema/createPetSchemas';
import {
  buildTransferNgoSeed,
  ensureUniqueNgoPetId,
  ensureUniqueTag,
  handleKnownError,
  maybeGenerateNgoPetId,
  resolveActiveUser,
} from './profileHelpers';

export async function handleCreatePetProfile(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);
  await connectToMongoDB();

  try {
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

    const contentType = (
      ctx.event.headers?.['content-type'] ||
      ctx.event.headers?.['Content-Type'] ||
      ''
    ).toLowerCase();
    let files: ParsedMultipartForm['files'] = [];
    let rawFields: Record<string, unknown>;
    if (contentType.includes('multipart/form-data')) {
      const parsedForm = (await multipart.parse(ctx.event)) as ParsedMultipartForm;
      files = parsedForm.files || [];
      const { files: _f, ...fields } = parsedForm;
      rawFields = fields;
    } else {
      rawFields = (ctx.body as Record<string, unknown>) || {};
    }

    const normalizedBody = normalizeMultipartBody(rawFields);
    const parsed = parseBody(normalizedBody, createPetBodySchema);

    if (!parsed.ok) {
      return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
    }

    const user = await resolveActiveUser(authContext.userId);
    if (!user) {
      return response.errorResponse(404, 'petProfile.errors.userNotFound', ctx.event);
    }

    if (parsed.data.tagId) {
      await ensureUniqueTag(parsed.data.tagId);
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
      tagId: parsed.data.tagId,
      transferNGO: buildTransferNgoSeed(),
    });

    return response.successResponse(201, ctx.event, {
      message: 'petProfile.success.created',
      id: pet._id,
      result: sanitizePetDetail(pet),
    });
  } catch (error) {
    const knownError = handleKnownError(error, ctx.event);
    if (knownError) {
      return knownError;
    }
    throw error;
  }
}
