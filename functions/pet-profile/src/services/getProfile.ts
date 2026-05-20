import type { APIGatewayProxyResult } from 'aws-lambda';
import { requireAuthContext } from '@aws-ddd-api/shared/auth/context';
import { paginationQuerySchema, parsePathParam, tempIdString } from '@aws-ddd-api/shared/validation/common';
import type { RouteContext } from '../../../../types/lambda';
import mongoose from 'mongoose';
import { connectToMongoDB } from '../config/db';
import { loadAuthorizedPet } from '../utils/auth';
import { response } from '../utils/response';
import { sanitizePetBasic, sanitizePetFull, sanitizePetLineage, sanitizePetListSummary, sanitizePublicTagLookupPet } from '../utils/sanitize';
import { PUBLIC_TAG_PROJECTION } from './profileHelpers';

const PET_VIEWS = new Set(['basic', 'detail', 'full']);

type PublicOwnerContact = {
  ownerEmail: string | null;
  ownerPhoneNumber: string | null;
};

function toTrimmedStringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function loadPublicOwnerContact(userId: unknown): Promise<PublicOwnerContact> {
  if (!userId) {
    return { ownerEmail: null, ownerPhoneNumber: null };
  }

  const User = mongoose.model('User');
  const user = await User.findOne({
    _id: userId,
    deleted: { $ne: true },
  })
    .select({ email: 1, phoneNumber: 1, _id: 0 })
    .lean() as { email?: unknown; phoneNumber?: unknown } | null;

  return {
    ownerEmail: toTrimmedStringOrNull(user?.email),
    ownerPhoneNumber: toTrimmedStringOrNull(user?.phoneNumber),
  };
}

async function loadLatestPetLostId(petId: string): Promise<string | null> {
  const PetLost = mongoose.model('PetLost');
  const record = await PetLost.findOne({ petId })
    .sort({ createdAt: -1, _id: -1 })
    .select({ _id: 1 })
    .lean() as { _id?: mongoose.Types.ObjectId | string } | null;

  return record?._id ? String(record._id) : null;
}

/**
 * Returns one owned pet profile using the requested response projection. The
 * `view` query parameter controls whether the caller receives basic, lineage,
 * or full detail fields.
 */
export async function handleGetPetProfile(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  requireAuthContext(ctx.event);
  await connectToMongoDB();

  const view = ctx.event.queryStringParameters?.view || 'full';
  if (!PET_VIEWS.has(view)) {
    return response.errorResponse(400, 'petProfile.errors.invalidView', ctx.event);
  }

  const pet = await loadAuthorizedPet(ctx.event);
  const form =
    view === 'basic' ? sanitizePetBasic(pet) :
    view === 'detail' ? sanitizePetLineage(pet) :
    sanitizePetFull(pet);
  const data = { id: pet._id, ...(form ?? {}) } as Record<string, unknown>;

  if (view === 'basic') {
    data.latestPetLostId = await loadLatestPetLostId(String(pet._id));
  }

  return response.successResponse(200, ctx.event, {
    message: 'success.retrieved',
    data,
  });
}

/**
 * Resolves a public pet lookup by tag id using the restricted
 * `PUBLIC_TAG_PROJECTION`, then enriches the response with owner contact
 * fields (`ownerEmail`, `ownerPhoneNumber`) from the pet's linked `userId`.
 */
export async function handleGetPetProfileByTag(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  await connectToMongoDB();

  const tagParam = parsePathParam(ctx.event.pathParameters?.tagId, tempIdString());
  if (!tagParam.ok) {
    return response.errorResponse(tagParam.statusCode, tagParam.errorKey, ctx.event);
  }
  const tagId = tagParam.data;

  const Pet = mongoose.model('Pet');
  const pet = await Pet.findOne(
    {
      tagId,
      deleted: { $ne: true },
    },
    PUBLIC_TAG_PROJECTION
  ).lean();

  if (!pet) {
    return response.errorResponse(404, 'common.notFound', ctx.event);
  }

  const ownerContact = await loadPublicOwnerContact((pet as { userId?: unknown }).userId);

  return response.successResponse(200, ctx.event, {
    message: 'success.retrieved',
    data: sanitizePublicTagLookupPet(pet, ownerContact),
  });
}

/**
 * Returns the caller's pet list with shared pagination. NGO callers receive
 * NGO-scoped searching and sorting, while standard users receive only their
 * own active pets.
 */
export async function handleGetMyPetProfiles(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);
  await connectToMongoDB();

  const Pet = mongoose.model('Pet');
  const queryParams = ctx.event.queryStringParameters || {};
  const pagination = paginationQuerySchema().safeParse(queryParams);
  if (!pagination.success) {
    return response.errorResponse(400, 'common.invalidQueryParams', ctx.event);
  }
  const { page, limit } = pagination.data;
  const skip = (page - 1) * limit;

  if (authContext.ngoId) {
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
        .skip(skip)
        .limit(limit)
        .lean(),
      Pet.countDocuments(query),
    ]);

    return response.successResponse(200, ctx.event, {
      message: 'success.retrieved',
      data: sanitizePetListSummary(pets),
      pagination: { page, limit, total: totalNumber, totalPages: Math.ceil(totalNumber / limit) },
    });
  }

  const query = { userId: authContext.userId, deleted: false };
  const [pets, totalNumber] = await Promise.all([
    Pet.find(query)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Pet.countDocuments(query),
  ]);

  return response.successResponse(200, ctx.event, {
    message: 'success.retrieved',
    data: sanitizePetListSummary(pets),
    pagination: { page, limit, total: totalNumber, totalPages: Math.ceil(totalNumber / limit) },
  });
}
