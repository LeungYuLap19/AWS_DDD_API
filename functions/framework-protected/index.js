'use strict';

const { json, safeJsonParse } = require('@aws-ddd-api/shared');

exports.handler = async (event) => {
  const routeKey = `${event.httpMethod} ${event.resource}`;
  const authorizer = event.requestContext?.authorizer || {};

  if (routeKey === 'GET /framework/protected/config') {
    return json(200, {
      message: 'Protected config route reached',
      service: 'aws-ddd-api',
      handler: 'framework-protected',
      stage: process.env.STAGE_NAME,
      alias: process.env.LAMBDA_ALIAS_NAME,
      configNamespace: process.env.CONFIG_NAMESPACE,
      authContext: authorizer,
      notes: {
        authMode: process.env.AUTH_BYPASS === 'true' ? 'bypass' : 'shared-token',
        requestValidation: 'Body model validation is enabled on POST /framework/protected/widgets',
      },
    });
  }

  if (routeKey === 'POST /framework/protected/widgets') {
    const body = safeJsonParse(event.body) || {};

    return json(201, {
      message: 'Protected widget request accepted',
      service: 'aws-ddd-api',
      handler: 'framework-protected',
      stage: process.env.STAGE_NAME,
      alias: process.env.LAMBDA_ALIAS_NAME,
      authContext: authorizer,
      widget: {
        name: body.name,
        description: body.description || null,
      },
    });
  }

  return json(404, {
    message: 'Protected route not found',
    routeKey,
  });
};
