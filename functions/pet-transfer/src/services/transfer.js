'use strict';

const { proxyRoot, proxyAny } = require('../applications/proxy');

async function handleProxyRoot(ctx) {
  return proxyRoot({ ...ctx, domain: 'pet-transfer' });
}

async function handleProxyAny(ctx) {
  return proxyAny({ ...ctx, domain: 'pet-transfer' });
}

module.exports = {
  handleProxyRoot,
  handleProxyAny,
};
