'use strict';

async function proxyRoot({ domain, event, json }) {
  return json(200, { success: true });
}

async function proxyAny({ domain, event, body, json }) {
  return json(200, { success: true });
}

module.exports = {
  proxyRoot,
  proxyAny,
};
