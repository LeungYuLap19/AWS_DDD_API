import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { json } from '@aws-ddd-api/shared';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return json(200, {
    success: true,
    service: 'pipeline-smoke',
    project: process.env.PROJECT_NAME,
    method: event.httpMethod,
    resource: event.resource,
    stage: process.env.STAGE_NAME,
    alias: process.env.LAMBDA_ALIAS_NAME,
    requestId: event.requestContext?.requestId || null,
    timestamp: new Date().toISOString(),
  });
}
