import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as shared from '@aws-ddd-api/shared';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return shared.json(200, {
    success: true,
    service: 'pipeline-smoke',
    project: process.env.PROJECT_NAME,
    method: event.httpMethod,
    resource: event.resource,
    stage: process.env.STAGE_NAME,
    alias: process.env.LAMBDA_ALIAS_NAME,
    requestId: event.requestContext?.requestId || null,
    timestamp: new Date().toISOString(),
    sharedLayer: {
      importOk: true,
      exportedKeys: Object.keys(shared).sort(),
    },
  });
}
