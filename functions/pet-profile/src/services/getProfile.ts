import type { APIGatewayProxyResult } from 'aws-lambda';
import { requireAuthContext } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import mongoose from 'mongoose';
import { connectToMongoDB } from '../config/db';
import { loadAuthorizedPet } from '../utils/auth';
import { response } from '../utils/response';
import { sanitizePetDetail, sanitizePetListSummary, sanitizePublicTagLookupPet } from '../utils/sanitize';
import { PUBLIC_TAG_PROJECTION, handleKnownError } from './profileHelpers';

export async function handleGetPetProfile(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  requireAuthContext(ctx.event);
  await connectToMongoDB();

  try {
    const pet = await loadAuthorizedPet(ctx.event);
    return response.successResponse(200, ctx.event, {
      message: 'petProfile.success.retrieved',
      form: sanitizePetDetail(pet),
      id: pet._id,
    });
  } catch (error) {
    const knownError = handleKnownError(error, ctx.event);
    if (knownError) return knownError;
    throw error;
  }
}

export async function handleGetPetProfileByTag(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  await connectToMongoDB();

  const tagId = ctx.event.pathParameters?.tagId;
  if (!tagId) {
    return response.errorResponse(400, 'petProfile.errors.missingTagId', ctx.event);
  }

  const Pet = mongoose.model('Pet');
  const pet = await Pet.findOne(
    {
      tagId,
      deleted: { $ne: true },
    },
    PUBLIC_TAG_PROJECTION
  ).lean();

  return response.successResponse(200, ctx.event, {
    message: 'petProfile.success.tagLookupProcessed',
    form: sanitizePublicTagLookupPet(pet),
  });
}

export async function handleGetMyPetProfiles(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);
  await connectToMongoDB();

  const Pet = mongoose.model('Pet');
  const pageNumber = Math.max(1, parseInt(ctx.event.queryStringParameters?.page || '1', 10));

  if (authContext.ngoId) {
    const queryParams = ctx.event.queryStringParameters || {};
    const search = typeof queryParams.search === 'string' ? queryParams.search.trim() : '';
    const sortByAllowlist = new Set([
      'updatedAt',
      'createdAt',
      'name',
      'animal',
      'breed',
      'birthday',
      'receivedDate',
      'ngoPetId',
    ]);
    const sortBy = sortByAllowlist.has(String(queryParams.sortBy)) ? String(queryParams.sortBy) : 'updatedAt';
    const sortOrder = String(queryParams.sortOrder || 'desc').toLowerCase() === 'asc' ? 1 : -1;
    const query: Record<string, unknown> = {
      ngoId: authContext.ngoId,
      deleted: false,
    };

    if (search) {
      const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { name: { $regex: safeSearch, $options: 'i' } },
        { animal: { $regex: safeSearch, $options: 'i' } },
        { breed: { $regex: safeSearch, $options: 'i' } },
        { ngoPetId: { $regex: safeSearch, $options: 'i' } },
        { locationName: { $regex: safeSearch, $options: 'i' } },
        { owner: { $regex: safeSearch, $options: 'i' } },
      ];
    }

    const [pets, totalNumber] = await Promise.all([
      Pet.find(query)
        .sort({ [sortBy]: sortOrder, _id: -1 })
        .skip((pageNumber - 1) * 30)
        .limit(30)
        .lean(),
      Pet.countDocuments(query),
    ]);

    if (!pets.length) {
      return response.errorResponse(404, 'petProfile.errors.noPetsFound', ctx.event);
    }

    return response.successResponse(200, ctx.event, {
      message: 'petProfile.success.listRetrieved',
      pets: sanitizePetListSummary(pets),
      total: totalNumber,
      currentPage: pageNumber,
      perPage: 30,
    });
  }

  const query = { userId: authContext.userId, deleted: false };
  const [pets, totalNumber] = await Promise.all([
    Pet.find(query)
      .sort({ updatedAt: -1 })
      .skip((pageNumber - 1) * 10)
      .limit(10)
      .lean(),
    Pet.countDocuments(query),
  ]);

  return response.successResponse(200, ctx.event, {
    message: 'petProfile.success.listRetrieved',
    form: sanitizePetListSummary(pets),
    total: totalNumber,
  });
}
