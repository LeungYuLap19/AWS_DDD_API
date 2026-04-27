import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as shared from '@aws-ddd-api/shared';

const smokeTranslations = {
  en: {
    pipelineSmoke: {
      ok: 'Pipeline smoke domain locale is available',
    },
  },
  zh: {
    pipelineSmoke: {
      ok: 'Pipeline smoke domain locale is available',
    },
  },
};

const response = shared.createResponse({
  domainTranslations: smokeTranslations,
});

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return response.successResponse(200, event, {
    message: 'pipelineSmoke.ok',
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
      domainLocaleOk: shared.translate('pipelineSmoke.ok', 'en', undefined, smokeTranslations),
      exportedKeys: Object.keys(shared).sort(),
    },
  });
}
