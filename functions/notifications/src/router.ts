import { createRouter } from '@aws-ddd-api/shared';
import { response } from './utils/response';

const routes = {
  'GET /notifications/me': () => import('./services/notifications').then(m => m.handleListNotifications),
  'PATCH /notifications/me/{notificationId}': () => import('./services/notifications').then(m => m.handleArchiveNotification),
  'POST /notifications/dispatch': () => import('./services/notifications').then(m => m.handleDispatchNotification),
};

export const routeRequest = createRouter(routes, { response });
