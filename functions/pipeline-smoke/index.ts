import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { json, safeJsonParse } from '@aws-ddd-api/shared';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = safeJsonParse(event.body);

  return json(200, {
    message: 'Pipeline smoke route is healthy',
    service: 'aws-ddd-api',
    handler: 'pipeline-smoke',
    method: event.httpMethod,
    resource: event.resource,
    path: event.path,
    stage: process.env.STAGE_NAME,
    alias: process.env.LAMBDA_ALIAS_NAME,
    requestId: event.requestContext?.requestId || null,
    input: body,
  });
}
