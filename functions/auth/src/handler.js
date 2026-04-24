'use strict';

const { safeJsonParse, json } = require('@aws-ddd-api/shared');
const { routeRequest } = require('./router');

async function handleRequest(event, context) {
  context.callbackWaitsForEmptyEventLoop = false;
  event.awsRequestId = context.awsRequestId;

  const body = safeJsonParse(event.body);
  return routeRequest({ event, body, json });
}

module.exports = { handleRequest };
