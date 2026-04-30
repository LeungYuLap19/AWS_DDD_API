import type { APIGatewayProxyResult } from 'aws-lambda';
import type { RouteContext } from '../../../../types/lambda';
import { HttpError } from '../utils/httpError';
import { response } from '../utils/response';

export const PUBLIC_TAG_PROJECTION = {
  name: 1,
  breedimage: 1,
  animal: 1,
  birthday: 1,
  weight: 1,
  sex: 1,
  sterilization: 1,
  breed: 1,
  features: 1,
  info: 1,
  status: 1,
  receivedDate: 1,
};

export function handleKnownError(error: unknown, event: RouteContext['event']): APIGatewayProxyResult | null {
  if (error instanceof HttpError) {
    return response.errorResponse(error.statusCode, error.errorKey, event);
  }

  const key = error instanceof Error ? error.message : '';
  if (key.includes('.')) {
    const statusCode = (error as { statusCode?: number }).statusCode || 400;
    return response.errorResponse(statusCode, key, event);
  }

  return null;
}
