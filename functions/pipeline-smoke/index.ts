import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as shared from '@aws-ddd-api/shared';

const smokeTranslations = {
  en: {
    pipelineSmoke: {
      envMissing: 'Pipeline smoke required environment is missing',
      ok: 'Pipeline smoke domain locale is available',
    },
  },
  zh: {
    pipelineSmoke: {
      envMissing: 'Pipeline smoke 必要環境變數缺失',
      ok: 'Pipeline smoke domain 語系已成功載入',
    },
  },
};

const response = shared.createResponse({
  domainTranslations: smokeTranslations,
});

const requiredEnvKeys = [
  'PROJECT_NAME',
  'STAGE_NAME',
  'LAMBDA_ALIAS_NAME',
  'CONFIG_NAMESPACE',
  'NODE_ENV',
  'ALLOWED_ORIGINS',
  'MONGODB_URI',
  'AUTH_BYPASS',
  'JWT_SECRET',
];

function isDevelopmentCorsConfigured(): boolean {
  return process.env.STAGE_NAME !== 'development' || process.env.ALLOWED_ORIGINS === '*';
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const missingEnv = requiredEnvKeys.filter((key) => !process.env[key]);

  if (missingEnv.length > 0) {
    return response.errorResponse(500, 'pipelineSmoke.envMissing', event, {
      'x-missing-env-count': String(missingEnv.length),
    });
  }

  if (!isDevelopmentCorsConfigured()) {
    return response.errorResponse(500, 'pipelineSmoke.envMissing', event, {
      'x-env-error': 'development-cors-not-wildcard',
    });
  }

  return response.successResponse(200, event, {
    message: 'pipelineSmoke.ok',
    service: 'pipeline-smoke',
    project: process.env.PROJECT_NAME,
    method: event.httpMethod,
    resource: event.resource,
    stage: process.env.STAGE_NAME,
    alias: process.env.LAMBDA_ALIAS_NAME,
    env: {
      requiredKeysPresent: true,
      developmentCorsWildcard: process.env.STAGE_NAME === 'development'
        ? process.env.ALLOWED_ORIGINS === '*'
        : null,
      checkedKeys: requiredEnvKeys,
    },
    requestId: event.requestContext?.requestId || null,
    timestamp: new Date().toISOString(),
    sharedLayer: {
      importOk: true,
      domainLocaleOk: shared.translate('pipelineSmoke.ok', 'en', undefined, smokeTranslations),
      exportedKeys: Object.keys(shared).sort(),
    },
  });
}
