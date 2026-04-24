'use strict';

const { proxyRoot, proxyAny } = require('../applications/proxy');

async function handleProxyRoot(ctx) {
  return proxyRoot({ ...ctx, domain: 'notifications' });
}

async function handleProxyAny(ctx) {
  return proxyAny({ ...ctx, domain: 'notifications' });
}

module.exports = {
  handleProxyRoot,
  handleProxyAny,
};
