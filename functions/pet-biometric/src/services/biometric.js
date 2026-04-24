'use strict';

const { proxyRoot, proxyAny } = require('../applications/proxy');

async function handleProxyRoot(ctx) {
  return proxyRoot({ ...ctx, domain: 'pet-biometric' });
}

async function handleProxyAny(ctx) {
  return proxyAny({ ...ctx, domain: 'pet-biometric' });
}

module.exports = {
  handleProxyRoot,
  handleProxyAny,
};
