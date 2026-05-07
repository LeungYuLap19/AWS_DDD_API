import type { APIGatewayProxyResult } from 'aws-lambda';
import { requireAuthContext } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import mongoose from 'mongoose';
import { connectToMongoDB } from '../config/db';
import { buildOwnershipFilter, loadAuthorizedPet } from '../utils/auth';
import { response } from '../utils/response';
import { applyRateLimit } from '../utils/rateLimit';

export async function handleDeletePetProfile(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);
  await connectToMongoDB();

  const rateLimitResponse = await applyRateLimit({
    action: 'petProfile.delete',
    event: ctx.event,
    identifier: authContext.userId,
    limit: 10,
    windowSeconds: 60,
  });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  await loadAuthorizedPet(ctx.event);

  const Pet = mongoose.model('Pet');
  const petId = String(ctx.event.pathParameters?.petId || '');
  const ownershipFilter = buildOwnershipFilter(ctx.event, petId);
  const deletedPet = await Pet.findOneAndUpdate(
    ownershipFilter,
    { $set: { deleted: true, tagId: null } },
    { returnDocument: 'after' }
  );

  if (deletedPet) {
    return response.successResponse(200, ctx.event, {
      message: 'success.deleted',
    });
  }

  const pet = (await Pet.findOne({ _id: petId }).select('userId ngoId deleted').lean()) as
    | { deleted?: boolean }
    | null;
  if (!pet) {
    return response.errorResponse(404, 'petProfile.errors.petNotFound', ctx.event);
  }

  if (pet.deleted === true) {
    return response.errorResponse(409, 'petProfile.errors.petAlreadyDeleted', ctx.event);
  }

  return response.errorResponse(403, 'common.forbidden', ctx.event);
}
