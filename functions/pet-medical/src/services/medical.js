'use strict';

const { proxyRoot, proxyAny } = require('../applications/proxy');

async function handleProxyRoot(ctx) {
  return proxyRoot({ ...ctx, domain: 'pet-medical' });
}

async function handleProxyAny(ctx) {
  return proxyAny({ ...ctx, domain: 'pet-medical' });
}

module.exports = {
  handleProxyRoot,
  handleProxyAny,
};
