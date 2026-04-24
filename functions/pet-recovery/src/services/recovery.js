'use strict';

const { proxyRoot, proxyAny } = require('../applications/proxy');

async function handleProxyRoot(ctx) {
  return proxyRoot({ ...ctx, domain: 'pet-recovery' });
}

async function handleProxyAny(ctx) {
  return proxyAny({ ...ctx, domain: 'pet-recovery' });
}

module.exports = {
  handleProxyRoot,
  handleProxyAny,
};
