'use strict';

const { json, safeJsonParse } = require('@aws-ddd-api/shared');

exports.handler = async (event) => {
  const routeKey = `${event.httpMethod} ${event.resource}`;
  const proxyPath = event.pathParameters?.proxy || '';
  const body = safeJsonParse(event.body);

  if (routeKey === 'GET /framework/proxy/{proxy+}') {
    return json(200, {
      message: 'Proxy GET route reached',
      service: 'aws-ddd-api',
      handler: 'framework-proxy',
      proxyPath,
      query: event.queryStringParameters || {},
      stage: process.env.STAGE_NAME,
    });
  }

  if (routeKey === 'POST /framework/proxy/{proxy+}') {
    return json(201, {
      message: 'Proxy POST route reached',
      service: 'aws-ddd-api',
      handler: 'framework-proxy',
      proxyPath,
      input: body,
      stage: process.env.STAGE_NAME,
    });
  }

  if (routeKey === 'GET /framework/proxy') {
    return json(200, {
      message: 'Proxy root reached',
      service: 'aws-ddd-api',
      handler: 'framework-proxy',
      proxyPath: '',
      stage: process.env.STAGE_NAME,
    });
  }

  return json(404, {
    message: 'Proxy route not found',
    routeKey,
    proxyPath,
  });
};
