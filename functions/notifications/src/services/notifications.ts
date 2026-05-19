import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { requireAuthContext } from '@aws-ddd-api/shared/auth/context';
import { paginationQuerySchema, parseObjectIdParam } from '@aws-ddd-api/shared/validation/common';
import { parseBody } from '@aws-ddd-api/shared/validation/zod';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { dispatchNotificationSchema } from '../zodSchema/notificationSchema';
import { applyRateLimit } from '../utils/rateLimit';
import { response } from '../utils/response';

type MongooseDocument = { toObject: () => Record<string, unknown> };

function sanitizeNotification(notification: MongooseDocument): Record<string, unknown> {
  const { __v, ...safe } = notification.toObject();
  return safe;
}

function parseDateString(dateString: string | null | undefined): Date | null {
  if (!dateString) return null;

  if (dateString.includes('T') || /^\d{4}-\d{2}-\d{2}/.test(dateString)) {
    return new Date(dateString);
  }

  const [day, month, year] = dateString.split('/');
  return new Date(Number(year), Number(month) - 1, Number(day));
}

/**
 * Returns the authenticated user's notifications in reverse-chronological
 * order with shared pagination semantics.
 */
export async function handleListNotifications(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);
  await connectToMongoDB();

  const pagination = paginationQuerySchema().safeParse(ctx.event.queryStringParameters ?? {});
  if (!pagination.success) {
    return response.errorResponse(400, 'common.invalidQueryParams', ctx.event);
  }
  const { page, limit } = pagination.data;
  const skip = (page - 1) * limit;

  const Notifications = mongoose.model('Notifications');
  const [notifications, total] = (await Promise.all([
    Notifications.find({ userId: authContext.userId })
      .select('-__v')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Notifications.countDocuments({ userId: authContext.userId }),
  ])) as [Record<string, unknown>[], number];

  return response.successResponse(200, ctx.event, {
    message: 'success.retrieved',
    data: notifications,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}

/**
 * Archives one notification owned by the authenticated user. The update is
 * ownership-scoped so other users' records cannot be toggled by id alone.
 */
export async function handleArchiveNotification(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);
  const idParam = parseObjectIdParam(ctx.event.pathParameters?.notificationId);
  if (!idParam.ok) {
    return response.errorResponse(idParam.statusCode, idParam.errorKey, ctx.event);
  }
  const notificationId = idParam.data;

  await connectToMongoDB();

  const Notifications = mongoose.model('Notifications');
  const result = await Notifications.updateOne(
    { _id: notificationId, userId: authContext.userId },
    { $set: { isArchived: true } }
  );

  if (result.matchedCount === 0) {
    return response.errorResponse(404, 'common.notFound', ctx.event);
  }

  return response.successResponse(200, ctx.event, {
    message: 'success.updated',
  });
}

/**
 * Authenticated notification dispatch endpoint that materializes a notification
 * document from a validated domain event payload.
 */
export async function handleDispatchNotification(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);

  const parsed = parseBody(ctx.body, dispatchNotificationSchema);
  if (!parsed.ok) {
    return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
  }

  await connectToMongoDB();

  const { targetUserId, type, petId, petName, nextEventDate, nearbyPetLost } = parsed.data;
  const rateLimitResponse = await applyRateLimit({
    action: 'notifications.dispatch',
    accountId: targetUserId,
    event: ctx.event,
    identifier: authContext.userId,
    policies: [
      { scope: 'ip', limit: 120, windowSeconds: 5 * 60 },
      { scope: 'identifier', limit: 60, windowSeconds: 5 * 60 },
      { scope: 'account', limit: 60, windowSeconds: 5 * 60 },
    ],
  });
  if (rateLimitResponse) return rateLimitResponse;

  const Notifications = mongoose.model('Notifications');
  const notification = await Notifications.create({
    userId: targetUserId,
    type,
    isArchived: false,
    petId: petId ?? null,
    petName: petName ?? null,
    nextEventDate: parseDateString(nextEventDate),
    nearbyPetLost: nearbyPetLost ?? null,
  }) as MongooseDocument;

  return response.successResponse(200, ctx.event, {
    message: 'success.created',
    data: sanitizeNotification(notification),
  });
}
