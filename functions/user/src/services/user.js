'use strict';

const { proxyRoot, proxyAny } = require('../applications/proxy');

async function handleProxyRoot(ctx) {
  return proxyRoot({ ...ctx, domain: 'user' });
}

async function handleProxyAny(ctx) {
  return proxyAny({ ...ctx, domain: 'user' });
}

module.exports = {
  handleProxyRoot,
  handleProxyAny,
};
