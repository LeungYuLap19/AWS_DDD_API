'use strict';

const json = (statusCode, payload) => ({
  statusCode,
  headers: {
    'content-type': 'application/json'
  },
  body: JSON.stringify(payload)
});

exports.handler = async (event) => {
  const routeKey = event.routeKey;
  const requestId = event.requestContext?.requestId || null;
  const stage = process.env.STAGE_NAME || 'dev';
  const id = event.pathParameters?.id || null;

  if (routeKey === 'GET /hello') {
    return json(200, {
      message: 'Hello from GET',
      method: 'GET',
      route: '/hello',
      stage,
      requestId
    });
  }

  if (routeKey === 'POST /hello') {
    const body = safeParse(event.body);
    return json(201, {
      message: 'Hello from POST',
      method: 'POST',
      route: '/hello',
      stage,
      requestId,
      input: body
    });
  }

  if (routeKey === 'PUT /hello/{id}') {
    const body = safeParse(event.body);
    return json(200, {
      message: 'Hello from PUT',
      method: 'PUT',
      route: '/hello/{id}',
      id,
      stage,
      requestId,
      input: body
    });
  }

  if (routeKey === 'DELETE /hello/{id}') {
    return json(200, {
      message: 'Hello from DELETE',
      method: 'DELETE',
      route: '/hello/{id}',
      id,
      stage,
      requestId
    });
  }

  return json(404, {
    message: 'Route not found',
    routeKey
  });
};

function safeParse(body) {
  if (!body) {
    return null;
  }

  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}
