import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import multipart from 'lambda-multipart-parser';
import { parseBody, requireAuthContext } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import env from '../config/env';
import { loadAuthorizedPet } from '../utils/auth';
import { response } from '../utils/response';
import { applyRateLimit } from '../utils/rateLimit';
import { sanitizeEyeLog, sanitizePet } from '../utils/sanitize';
import { uploadImageFile } from '../utils/upload';
import { isValidDateFormat, isValidImageUrl, toTrimmedString } from '../utils/validators';
import { updatePetEyeSchema } from '../zodSchema/updatePetEyeSchema';
import { HttpError } from '../utils/httpError';

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/tiff',
]);
const MAX_FILE_SIZE_MB = 30;

async function postJson(url: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const analysisResponse = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return (await analysisResponse.json()) as Record<string, unknown>;
}

function normalizeError(error: unknown, event: RouteContext['event']): APIGatewayProxyResult | null {
  if (error instanceof HttpError) {
    return response.errorResponse(error.statusCode, error.errorKey, event);
  }

  return null;
}

function isAnalysisErrorPayload(payload: Record<string, unknown>): boolean {
  const keys = Object.keys(payload);
  return keys.includes('error') || keys.includes('400') || keys.includes('404');
}

export async function handleGetEye(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  await connectToMongoDB();

  const identifier = toTrimmedString(ctx.event.pathParameters?.identifier);
  if (!identifier) {
    return response.errorResponse(400, 'petAnalysis.errors.missingEyeDiseaseName', ctx.event);
  }

  if (!mongoose.isValidObjectId(identifier)) {
    const EyeDiseaseList = mongoose.model('EyeDiseaseList');
    const eyeDisease = (await EyeDiseaseList.findOne({ eyeDisease_eng: decodeURIComponent(identifier) }).lean()) as
      | Record<string, unknown>
      | null;

    if (!eyeDisease && decodeURIComponent(identifier) === 'Normal') {
      return response.successResponse(201, ctx.event, {
        result: {
          id: null,
          eyeDiseaseEng: null,
          eyeDiseaseChi: null,
          eyeDiseaseCause: null,
          eyeDiseaseSolution: null,
        },
        message: 'petAnalysis.success.eyeDiseaseRetrieved',
      });
    }

    if (!eyeDisease) {
      return response.errorResponse(404, 'petAnalysis.errors.eyeDiseaseNotFound', ctx.event);
    }

    return response.successResponse(201, ctx.event, {
      result: eyeDisease,
      message: 'petAnalysis.success.eyeDiseaseRetrieved',
    });
  }

  try {
    requireAuthContext(ctx.event);
    await loadAuthorizedPet(ctx.event, identifier, { allowNgo: true });

    const EyeAnalysis = mongoose.model('EyeAnalysisRecord');
    const eyeAnalysisLogList = (await EyeAnalysis.find({ petId: identifier })
      .select('_id petId image eyeSide result createdAt updatedAt')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean()) as Record<string, unknown>[];

    return response.successResponse(200, ctx.event, {
      message: 'petAnalysis.success.eyeLogRetrievedSuccessfully',
      result: eyeAnalysisLogList.map(sanitizeEyeLog),
    });
  } catch (error) {
    const known = normalizeError(error, ctx.event);
    if (known) return known;
    throw error;
  }
}

export async function handlePostEye(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const startTime = performance.now();
  const authContext = requireAuthContext(ctx.event);
  await connectToMongoDB();

  const rateLimitResponse = await applyRateLimit({
    action: 'eyeUploadAnalysis',
    event: ctx.event,
    identifier: authContext.userId,
    limit: 10,
    windowSeconds: 300,
  });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const petId = toTrimmedString(ctx.event.pathParameters?.identifier);
  if (!petId || !mongoose.isValidObjectId(petId)) {
    return response.errorResponse(400, 'petAnalysis.errors.invalidObjectId', ctx.event);
  }

  const ApiLog = mongoose.model('ApiLog');
  const User = mongoose.model('User');
  const EyeAnalysisLog = mongoose.model('EyeAnalysisRecord');

  let activityLog = await ApiLog.create({});

  try {
    const user = (await User.findOne({ _id: authContext.userId, deleted: { $ne: true } }).lean()) as
      | { _id: unknown }
      | null;
    if (!user) {
      activityLog.error = 'USER_NOT_FOUND';
      await activityLog.save();
      return response.errorResponse(404, 'petAnalysis.errors.userNotFound', ctx.event);
    }

    await loadAuthorizedPet(ctx.event, petId, { allowNgo: true });

    const formData = await multipart.parse(ctx.event);
    const imageUrl = toTrimmedString(formData.image_url);
    const file = formData.files?.[0];

    if (!imageUrl && !file) {
      activityLog.error = 'MISSING_ARGUMENTS';
      await activityLog.save();
      return response.errorResponse(400, 'petAnalysis.errors.missingArguments', ctx.event);
    }

    let downloadURL = imageUrl;
    if (file) {
      const fileSizeInMb = file.content.length / (1024 * 1024);

      if (!ALLOWED_IMAGE_TYPES.has(file.contentType || '')) {
        activityLog.error = 'IMAGE_ERROR_UNSUPPORTED_FORMAT';
        await activityLog.save();
        return response.errorResponse(400, 'petAnalysis.errors.unsupportedFormat', ctx.event);
      }

      if (fileSizeInMb > MAX_FILE_SIZE_MB) {
        activityLog.error = 'IMAGE_FILE_TOO_LARGE';
        await activityLog.save();
        return response.errorResponse(413, 'petAnalysis.errors.fileTooLarge', ctx.event);
      }

      if (fileSizeInMb === 0) {
        activityLog.error = 'IMAGE_FILE_TOO_SMALL';
        await activityLog.save();
        return response.errorResponse(413, 'petAnalysis.errors.fileTooSmall', ctx.event);
      }

      downloadURL = await uploadImageFile({
        buffer: file.content,
        originalname: file.filename,
        folder: `user-uploads/eye/${petId}`,
      });
    }

    const endpointURL = `${env.VM_PUBLIC_IP}${env.DOCKER_IMAGE}`;
    const endpointHeatmapURL = `${env.VM_PUBLIC_IP}${env.HEATMAP}`;

    const [analysis, heatmapResult] = await Promise.allSettled([
      postJson(endpointURL, { url: downloadURL }),
      postJson(endpointHeatmapURL, { url: downloadURL }),
    ]);

    if (analysis.status !== 'fulfilled' || !analysis.value) {
      activityLog.error = 'ANALYSIS_FAILED';
      await activityLog.save();
      return response.errorResponse(500, 'petAnalysis.errors.analysisError', ctx.event);
    }

    if (isAnalysisErrorPayload(analysis.value)) {
      activityLog.error = Object.values(analysis.value)[0] || 'ANALYSIS_FAILED';
      await activityLog.save();
      return response.errorResponse(400, 'petAnalysis.errors.analysisError', ctx.event);
    }

    const heatmap = heatmapResult.status === 'fulfilled' ? heatmapResult.value?.heatmap : null;

    activityLog.userId = user._id;
    activityLog.image_url = downloadURL;
    activityLog.result = analysis.value;
    await activityLog.save();

    await EyeAnalysisLog.create({
      result: analysis.value,
      image: downloadURL,
      petId,
      heatmap,
    });

    const timeTaken = performance.now() - startTime;

    return response.successResponse(200, ctx.event, {
      result: analysis.value,
      heatmap,
      request_id: activityLog._id,
      time_taken: `${timeTaken} ms`,
      status: 200,
    });
  } catch (error) {
    try {
      activityLog.error = 'INTERNAL_ERROR';
      await activityLog.save();
    } catch {
      // ignore activity log failure during error flow
    }

    const known = normalizeError(error, ctx.event);
    if (known) return known;
    throw error;
  }
}

export async function handlePatchEye(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);
  await connectToMongoDB();

  const rateLimitResponse = await applyRateLimit({
    action: 'petEyeUpdate',
    event: ctx.event,
    identifier: authContext.userId,
    limit: 10,
    windowSeconds: 60,
  });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const parsed = parseBody(ctx.body, updatePetEyeSchema);
  if (!parsed.ok) {
    return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
  }

  const { petId, date, leftEyeImage1PublicAccessUrl, rightEyeImage1PublicAccessUrl } = parsed.data;
  const routePetId = toTrimmedString(ctx.event.pathParameters?.identifier);

  if (!mongoose.isValidObjectId(petId) || routePetId !== petId) {
    return response.errorResponse(400, 'petAnalysis.errors.updatePetEye.invalidPetIdFormat', ctx.event);
  }

  if (!isValidDateFormat(date)) {
    return response.errorResponse(400, 'petAnalysis.errors.updatePetEye.invalidDateFormat', ctx.event);
  }

  if (!isValidImageUrl(leftEyeImage1PublicAccessUrl) || !isValidImageUrl(rightEyeImage1PublicAccessUrl)) {
    return response.errorResponse(400, 'petAnalysis.errors.updatePetEye.invalidImageUrlFormat', ctx.event);
  }

  const Pet = mongoose.model('Pet');
  const newInformation = {
    date: new Date(date),
    eyeimage_left1: leftEyeImage1PublicAccessUrl,
    eyeimage_right1: rightEyeImage1PublicAccessUrl,
  };

  const updatedPet = (await Pet.findOneAndUpdate(
    { _id: petId, userId: authContext.userId, deleted: { $ne: true } },
    { $push: { eyeimages: newInformation } },
    { new: true, lean: true }
  )) as Record<string, unknown> | null;

  if (updatedPet) {
    return response.successResponse(201, ctx.event, {
      message: 'petAnalysis.success.petEyeUpdated',
      result: sanitizePet(updatedPet),
    });
  }

  const pet = (await Pet.findOne({ _id: petId }).select('userId deleted').lean()) as
    | { deleted?: boolean }
    | null;

  if (!pet) {
    return response.errorResponse(404, 'petAnalysis.errors.updatePetEye.petNotFound', ctx.event);
  }

  if (pet.deleted === true) {
    return response.errorResponse(410, 'petAnalysis.errors.updatePetEye.petDeleted', ctx.event);
  }

  return response.errorResponse(403, 'common.unauthorized', ctx.event);
}
