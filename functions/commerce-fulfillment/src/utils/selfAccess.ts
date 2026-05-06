import type { APIGatewayProxyEvent } from 'aws-lambda';
import mongoose from 'mongoose';
import { getAuthContext } from '@aws-ddd-api/shared';
import { response } from './response';
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

interface OwnerValidation {
  isValid: boolean;
  error?: ReturnType<typeof response.errorResponse>;
}

function validateOwnerEmail(event: APIGatewayProxyEvent, ownerEmail: string | undefined): OwnerValidation {
  if (isPrivilegedCaller(event)) {
    return { isValid: true };
  }

  const callerEmail = getCallerEmail(event);
  const normalizedOwnerEmail = normalizeEmail(ownerEmail);

  if (!callerEmail || !normalizedOwnerEmail || callerEmail !== normalizedOwnerEmail) {
    return {
      isValid: false,
      error: response.errorResponse(403, 'common.unauthorized', event),
    };
  }

  return { isValid: true };
}

type RawDocument = Record<string, unknown>;

interface OrderAuthorization {
  isValid: boolean;
  error?: ReturnType<typeof response.errorResponse>;
  order?: RawDocument | null;
}

interface OrderVerificationAuthorization {
  isValid: boolean;
  error?: ReturnType<typeof response.errorResponse>;
  orderVerification?: RawDocument | null;
  order?: RawDocument | null;
}

const ORDER_OWNERSHIP_PROJECTION = '_id tempId email';

export async function loadAuthorizedOrderByTempId(
  event: APIGatewayProxyEvent,
  Order: mongoose.Model<RawDocument>,
  tempId: string,
  projection = ORDER_OWNERSHIP_PROJECTION
): Promise<OrderAuthorization> {
  const order = await Order.findOne({ tempId }).select(projection).lean() as RawDocument | null;
  if (!order) {
    return { isValid: true, order: null };
  }

  const validation = validateOwnerEmail(event, order.email as string | undefined);
  if (!validation.isValid) {
    return validation;
  }

  return { isValid: true, order };
}

export async function loadAuthorizedSupplierOrderVerification(
  event: APIGatewayProxyEvent,
  OrderVerification: mongoose.Model<RawDocument>,
  Order: mongoose.Model<RawDocument>,
  identifier: string,
  projection: string
): Promise<OrderVerificationAuthorization> {
  let orderVerification = (await OrderVerification.findOne({ orderId: identifier }).select(projection).lean()) as RawDocument | null;
  if (!orderVerification) {
    orderVerification = (await OrderVerification.findOne({ contact: identifier }).select(projection).lean()) as RawDocument | null;
  }
  if (!orderVerification) {
    orderVerification = (await OrderVerification.findOne({ tagId: identifier }).select(projection).lean()) as RawDocument | null;
  }

  if (!orderVerification) {
    return { isValid: true, orderVerification: null, order: null };
  }

  if (isPrivilegedCaller(event)) {
    return { isValid: true, orderVerification, order: null };
  }

  if (orderVerification.orderId) {
    const orderAuth = await loadAuthorizedOrderByTempId(
      event,
      Order,
      orderVerification.orderId as string
    );
    if (!orderAuth.isValid) {
      return orderAuth;
    }
    if (orderAuth.order) {
      return { isValid: true, orderVerification, order: orderAuth.order };
    }
  }

  const fallback = validateOwnerEmail(event, orderVerification.masterEmail as string | undefined);
  if (!fallback.isValid) {
    return fallback;
  }

  return { isValid: true, orderVerification, order: null };
}
