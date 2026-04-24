import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { json, safeJsonParse } from '@aws-ddd-api/shared';
import { routeRequest } from './router';

export async function handleRequest(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {
  context.callbackWaitsForEmptyEventLoop = false;
  (event as APIGatewayProxyEvent & { awsRequestId?: string }).awsRequestId = context.awsRequestId;

  const body = safeJsonParse(event.body);
  return routeRequest({
    event: event as APIGatewayProxyEvent & { awsRequestId?: string },
    body,
    json,
  });
}
