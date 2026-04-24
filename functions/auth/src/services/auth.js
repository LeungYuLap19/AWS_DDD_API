'use strict';

const { proxyRoot, proxyAny } = require('../applications/proxy');

async function handleProxyRoot(ctx) {
  return proxyRoot({ ...ctx, domain: 'auth' });
}

async function handleProxyAny(ctx) {
  return proxyAny({ ...ctx, domain: 'auth' });
}

module.exports = {
  handleProxyRoot,
  handleProxyAny,
};
