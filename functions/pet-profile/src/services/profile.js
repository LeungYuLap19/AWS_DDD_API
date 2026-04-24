'use strict';

const { proxyRoot, proxyAny } = require('../applications/proxy');

async function handleProxyRoot(ctx) {
  return proxyRoot({ ...ctx, domain: 'pet-profile' });
}

async function handleProxyAny(ctx) {
  return proxyAny({ ...ctx, domain: 'pet-profile' });
}

module.exports = {
  handleProxyRoot,
  handleProxyAny,
};
