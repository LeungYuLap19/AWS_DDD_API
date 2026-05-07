import type { APIGatewayProxyEvent } from 'aws-lambda';
import mongoose from 'mongoose';
import { getAuthContext, HttpError } from '@aws-ddd-api/shared';
import { normalizeEmail } from './normalize';

const PRIVILEGED_ROLES = new Set(['admin', 'developer']);

function isPrivilegedCaller(event: APIGatewayProxyEvent): boolean {
  const authContext = getAuthContext(event);
  return authContext?.userRole ? PRIVILEGED_ROLES.has(authContext.userRole) : false;
}

function getCallerEmail(event: APIGatewayProxyEvent): string | undefined {
  const authContext = getAuthContext(event);
  return normalizeEmail(authContext?.userEmail);
}

function validateOwnerEmail(event: APIGatewayProxyEvent, ownerEmail: string | undefined): void {
  if (isPrivilegedCaller(event)) return;

  const callerEmail = getCallerEmail(event);
  const normalizedOwnerEmail = normalizeEmail(ownerEmail);

  if (!callerEmail || !normalizedOwnerEmail || callerEmail !== normalizedOwnerEmail) {
    throw new HttpError('common.forbidden', 403);
  }
}

type RawDocument = Record<string, unknown>;

interface OrderResult {
  order: RawDocument | null;
}

interface OrderVerificationResult {
  orderVerification: RawDocument | null;
  order: RawDocument | null;
}

const ORDER_OWNERSHIP_PROJECTION = '_id tempId email';

export async function loadAuthorizedOrderByTempId(
  event: APIGatewayProxyEvent,
  Order: mongoose.Model<RawDocument>,
  tempId: string,
  projection = ORDER_OWNERSHIP_PROJECTION
): Promise<OrderResult> {
  const order = await Order.findOne({ tempId }).select(projection).lean() as RawDocument | null;
  if (!order) {
    return { order: null };
  }

  validateOwnerEmail(event, order.email as string | undefined);

  return { order };
}

export async function loadAuthorizedSupplierOrderVerification(
  event: APIGatewayProxyEvent,
  OrderVerification: mongoose.Model<RawDocument>,
  Order: mongoose.Model<RawDocument>,
  identifier: string,
  projection: string
): Promise<OrderVerificationResult> {
  let orderVerification = (await OrderVerification.findOne({ orderId: identifier }).select(projection).lean()) as RawDocument | null;
  if (!orderVerification) {
    orderVerification = (await OrderVerification.findOne({ contact: identifier }).select(projection).lean()) as RawDocument | null;
  }
  if (!orderVerification) {
    orderVerification = (await OrderVerification.findOne({ tagId: identifier }).select(projection).lean()) as RawDocument | null;
  }

  if (!orderVerification) {
    return { orderVerification: null, order: null };
  }

  if (isPrivilegedCaller(event)) {
    return { orderVerification, order: null };
  }

  if (orderVerification.orderId) {
    const { order } = await loadAuthorizedOrderByTempId(
      event,
      Order,
      orderVerification.orderId as string
    );
    if (order) {
      return { orderVerification, order };
    }
  }

  validateOwnerEmail(event, orderVerification.masterEmail as string | undefined);

  return { orderVerification, order: null };
}
