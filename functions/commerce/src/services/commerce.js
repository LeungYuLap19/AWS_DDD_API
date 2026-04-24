'use strict';

const { proxyRoot, proxyAny } = require('../applications/proxy');

async function handleProxyRoot(ctx) {
  return proxyRoot({ ...ctx, domain: 'commerce' });
}

async function handleProxyAny(ctx) {
  return proxyAny({ ...ctx, domain: 'commerce' });
}

module.exports = {
  handleProxyRoot,
  handleProxyAny,
};
