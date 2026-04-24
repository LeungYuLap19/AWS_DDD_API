'use strict';

const { proxyRoot, proxyAny } = require('../applications/proxy');

async function handleProxyRoot(ctx) {
  return proxyRoot({ ...ctx, domain: 'ngo' });
}

async function handleProxyAny(ctx) {
  return proxyAny({ ...ctx, domain: 'ngo' });
}

module.exports = {
  handleProxyRoot,
  handleProxyAny,
};
