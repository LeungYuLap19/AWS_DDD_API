'use strict';

const { proxyRoot, proxyAny } = require('../applications/proxy');

async function handleProxyRoot(ctx) {
  return proxyRoot({ ...ctx, domain: 'logistics' });
}

async function handleProxyAny(ctx) {
  return proxyAny({ ...ctx, domain: 'logistics' });
}

module.exports = {
  handleProxyRoot,
  handleProxyAny,
};
