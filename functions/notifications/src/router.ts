import { createRouter } from '@aws-ddd-api/shared';
import type { RouteHandler } from '../../../types/lambda';
import { response } from './utils/response';
import {
  handleListNotifications,
  handleArchiveNotification,
  handleDispatchNotification,
} from './services/notifications';

const routes: Record<string, RouteHandler> = {
  'GET /notifications/me': handleListNotifications,
  'PATCH /notifications/me/{notificationId}': handleArchiveNotification,
  'POST /notifications/dispatch': handleDispatchNotification,
};

export const routeRequest = createRouter(routes, { response });
