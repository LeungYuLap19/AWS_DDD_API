import type { APIGatewayProxyResult } from 'aws-lambda';
import { requireAuthContext, parseMultipartBody } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { applyRateLimit } from '../utils/rateLimit';
import { response } from '../utils/response';
import { uploadImageFile } from '../utils/upload';
import { toTrimmedString } from '../utils/validators';
import { uploadImageSchema, uploadBreedImageSchema } from '../zodSchema/uploadSchema';

const ALLOWED_UPLOAD_PREFIXES = new Set(['breed_analysis', 'pets', 'eye', 'profile']);

export async function handleUploadImage(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);
  await connectToMongoDB();

  const rateLimitResponse = await applyRateLimit({
    action: 'uploadImage',
    event: ctx.event,
    identifier: authContext.userId,
    policies: [
      { scope: 'ip', limit: 90, windowSeconds: 300 },
      { scope: 'identifier', limit: 45, windowSeconds: 300 },
      { scope: 'ip+identifier', limit: 30, windowSeconds: 300 },
    ],
  });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const multiResult = await parseMultipartBody(ctx.event, uploadImageSchema, {});
  if (!multiResult.ok) {
    return response.errorResponse(multiResult.statusCode, multiResult.errorKey, ctx.event);
  }
  const files = multiResult.files;

  if (files.length === 0) {
    return response.errorResponse(400, 'petAnalysis.errors.noFilesUploaded', ctx.event);
  }

  if (files.length > 1) {
    return response.errorResponse(400, 'petAnalysis.errors.tooManyFiles', ctx.event);
  }

  const firstFile = files[0];
  if (!firstFile.content) {
    return response.errorResponse(400, 'petAnalysis.errors.noFilesUploaded', ctx.event);
  }

  let url: string;
  try {
    url = await uploadImageFile(
      { buffer: firstFile.content, originalname: firstFile.filename ?? '' },
      'user-uploads/breed_analysis'
    );
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === 'INVALID_FILE_TYPE') return response.errorResponse(400, 'petAnalysis.errors.invalidImageFormat', ctx.event);
    if (code === 'FILE_TOO_LARGE') return response.errorResponse(413, 'petAnalysis.errors.fileTooLarge', ctx.event);
    throw err;
  }

  return response.successResponse(200, ctx.event, {
    message: 'success.created',
    data: { url },
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
    policies: [
      { scope: 'ip', limit: 90, windowSeconds: 300 },
      { scope: 'identifier', limit: 45, windowSeconds: 300 },
      { scope: 'ip+identifier', limit: 30, windowSeconds: 300 },
    ],
  });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const multiResult = await parseMultipartBody(ctx.event, uploadBreedImageSchema, {});
  if (!multiResult.ok) {
    return response.errorResponse(multiResult.statusCode, multiResult.errorKey, ctx.event);
  }

  const firstFile = multiResult.files[0];
  if (!firstFile?.content) {
    return response.errorResponse(400, 'petAnalysis.errors.noFilesUploaded', ctx.event);
  }

  const rawPath = toTrimmedString(multiResult.data.url);
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

  let url: string;
  try {
    url = await uploadImageFile(
      { buffer: firstFile.content, originalname: firstFile.filename ?? '' },
      `user-uploads/${segments.join('/')}`
    );
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === 'INVALID_FILE_TYPE') return response.errorResponse(400, 'petAnalysis.errors.invalidImageFormat', ctx.event);
    if (code === 'FILE_TOO_LARGE') return response.errorResponse(413, 'petAnalysis.errors.fileTooLarge', ctx.event);
    throw err;
  }

  return response.successResponse(200, ctx.event, {
    message: 'success.created',
    data: { url },
  });
}

