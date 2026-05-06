import type { APIGatewayProxyResult } from 'aws-lambda';
import mongoose from 'mongoose';
import { parseBody, requireAuthContext, requireRole } from '@aws-ddd-api/shared';
import type { RouteContext } from '../../../../types/lambda';
import { connectToMongoDB } from '../config/db';
import { dispatchNotificationSchema } from '../zodSchema/notificationSchema';
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

export async function handleListNotifications(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);
  await connectToMongoDB();

  const Notifications = mongoose.model('Notifications');
  const notifications = (await Notifications.find({ userId: authContext.userId })
    .select('-__v')
    .sort({ createdAt: -1 })
    .lean()) as Record<string, unknown>[];

  return response.successResponse(200, ctx.event, {
    message: 'success.retrieved',
    count: notifications.length,
    notifications,
  });
}

export async function handleArchiveNotification(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  const authContext = requireAuthContext(ctx.event);
  const notificationId = ctx.event.pathParameters?.notificationId;

  if (!notificationId) {
    return response.errorResponse(400, 'common.missingPathParams', ctx.event);
  }

  if (!mongoose.Types.ObjectId.isValid(notificationId)) {
    return response.errorResponse(400, 'common.invalidObjectId', ctx.event);
  }

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
    notificationId,
  });
}

export async function handleDispatchNotification(ctx: RouteContext): Promise<APIGatewayProxyResult> {
  requireRole(ctx.event, 'admin');

  const parsed = parseBody(ctx.body, dispatchNotificationSchema);
  if (!parsed.ok) {
    return response.errorResponse(parsed.statusCode, parsed.errorKey, ctx.event);
  }

  await connectToMongoDB();

  const { targetUserId, type, petId, petName, nextEventDate, nearbyPetLost } = parsed.data;

  const Notifications = mongoose.model('Notifications');
  const notification = await Notifications.create({
    userId: targetUserId,
    type,
    petId: petId ?? null,
    petName: petName ?? null,
    nextEventDate: parseDateString(nextEventDate),
    nearbyPetLost: nearbyPetLost ?? null,
  }) as MongooseDocument;

  return response.successResponse(200, ctx.event, {
    message: 'success.created',
    notification: sanitizeNotification(notification),
  });
}
