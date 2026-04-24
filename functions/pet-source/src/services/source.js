'use strict';

const { proxyRoot, proxyAny } = require('../applications/proxy');

async function handleProxyRoot(ctx) {
  return proxyRoot({ ...ctx, domain: 'pet-source' });
}

async function handleProxyAny(ctx) {
  return proxyAny({ ...ctx, domain: 'pet-source' });
}

module.exports = {
  handleProxyRoot,
  handleProxyAny,
};
