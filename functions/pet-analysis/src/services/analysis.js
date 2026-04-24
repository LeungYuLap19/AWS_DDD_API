'use strict';

const { proxyRoot, proxyAny } = require('../applications/proxy');

async function handleProxyRoot(ctx) {
  return proxyRoot({ ...ctx, domain: 'pet-analysis' });
}

async function handleProxyAny(ctx) {
  return proxyAny({ ...ctx, domain: 'pet-analysis' });
}

module.exports = {
  handleProxyRoot,
  handleProxyAny,
};
