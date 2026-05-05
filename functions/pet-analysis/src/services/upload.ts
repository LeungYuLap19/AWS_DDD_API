import type { APIGatewayProxyResult } from 'aws-lambda';
import multipart from 'lambda-multipart-parser';
import { requireAuthContext } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { applyRateLimit } from '../utils/rateLimit';
import { response } from '../utils/response';
import { uploadImageFile } from '../utils/upload';
import { toTrimmedString } from '../utils/validators';

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png']);
const ALLOWED_UPLOAD_PREFIXES = new Set(['breed_analysis', 'pets', 'eye', 'profile']);

export async function handleUploadImage(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);
  await connectToMongoDB();

  const rateLimitResponse = await applyRateLimit({
    action: 'uploadImage',
    event: ctx.event,
    identifier: authContext.userId,
    limit: 30,
    windowSeconds: 300,
  });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const formData = await multipart.parse(ctx.event);
  const files = formData.files || [];

  if (files.length === 0) {
    return response.errorResponse(400, 'petAnalysis.errors.noFilesUploaded', ctx.event);
  }

  if (files.length > 1) {
    return response.errorResponse(400, 'petAnalysis.errors.tooManyFiles', ctx.event);
  }

  const firstFile = files[0];
  if (!ALLOWED_IMAGE_TYPES.has(firstFile.contentType || '')) {
    return response.errorResponse(400, 'petAnalysis.errors.invalidImageFormat', ctx.event);
  }

  const url = await uploadImageFile({
    buffer: firstFile.content,
    originalname: firstFile.filename,
    folder: 'user-uploads/breed_analysis',
  });

  return response.successResponse(200, ctx.event, {
    message: 'petAnalysis.success.imageUploaded',
    url,
  });
}

export async function handleUploadPetBreedImage(
  ctx: RouteContext
): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);
  await connectToMongoDB();

  const rateLimitResponse = await applyRateLimit({
    action: 'uploadPetBreedImage',
    event: ctx.event,
    identifier: authContext.userId,
    limit: 30,
    windowSeconds: 300,
  });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const formData = await multipart.parse(ctx.event);
  const firstFile = formData.files?.[0];

  if (!firstFile) {
    return response.errorResponse(400, 'petAnalysis.errors.noFilesUploaded', ctx.event);
  }

  if (!ALLOWED_IMAGE_TYPES.has(firstFile.contentType || '')) {
    return response.errorResponse(400, 'petAnalysis.errors.invalidImageFormat', ctx.event);
  }

  const rawPath = toTrimmedString(formData.url);
  if (!rawPath) {
    return response.errorResponse(400, 'petAnalysis.errors.invalidFolder', ctx.event);
  }

  const segments = rawPath.replace(/^\/+/, '').split('/').filter(Boolean);
  const topFolder = segments[0];

  if (!topFolder || !ALLOWED_UPLOAD_PREFIXES.has(topFolder)) {
    return response.errorResponse(400, 'petAnalysis.errors.invalidFolder', ctx.event);
  }

  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return response.errorResponse(400, 'petAnalysis.errors.invalidFolder', ctx.event);
  }

  const url = await uploadImageFile({
    buffer: firstFile.content,
    originalname: firstFile.filename,
    folder: `user-uploads/${segments.join('/')}`,
  });

  return response.successResponse(200, ctx.event, {
    message: 'petAnalysis.success.imageUploaded',
    url,
  });
}
