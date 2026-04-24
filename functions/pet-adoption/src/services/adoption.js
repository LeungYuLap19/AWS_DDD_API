'use strict';

const { proxyRoot, proxyAny } = require('../applications/proxy');

async function handleProxyRoot(ctx) {
  return proxyRoot({ ...ctx, domain: 'pet-adoption' });
}

async function handleProxyAny(ctx) {
  return proxyAny({ ...ctx, domain: 'pet-adoption' });
}

module.exports = {
  handleProxyRoot,
  handleProxyAny,
};
