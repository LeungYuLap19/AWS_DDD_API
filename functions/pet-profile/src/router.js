'use strict';

const { handleProxyRoot } = require('./services/profile');

function lazyRoute(modulePath, exportName) {
  return async function routeHandler(ctx) {
    const service = require(modulePath);
    return service[exportName](ctx);
  };
}

const routes = {
  'ANY /pet/profile': handleProxyRoot,
  'ANY /pet/profile/{proxy+}': lazyRoute('./services/profile', 'handleProxyAny'),
};

async function routeRequest(routeContext) {
  const routeKey = `${routeContext.event.httpMethod} ${routeContext.event.resource}`;
  const routeAction = routes[routeKey] || routes[`ANY ${routeContext.event.resource}`];

  if (!routeAction) {
    return routeContext.json(404, {
      message: 'Route not found',
      routeKey,
    });
  }

  return routeAction(routeContext);
}

module.exports = { routeRequest };
