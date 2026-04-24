'use strict';

const { buildPolicy, getBearerToken, isTrue } = require('@aws-ddd-api/shared');

exports.handler = async (event) => {
  const methodArn = event.methodArn || '*';
  const bypass = isTrue(process.env.AUTH_BYPASS, true);

  if (bypass) {
    return buildPolicy({
      principalId: 'local-bypass',
      effect: 'Allow',
      resource: methodArn,
      context: {
        authMode: 'bypass',
        stage: process.env.STAGE_NAME || 'dev',
      },
    });
  }

  const presentedToken = getBearerToken(event.authorizationToken);
  const expectedToken = process.env.AUTH_SHARED_TOKEN || '';

  if (!presentedToken || !expectedToken || presentedToken !== expectedToken) {
    return buildPolicy({
      principalId: 'unauthorized',
      effect: 'Deny',
      resource: methodArn,
      context: {
        authMode: 'shared-token',
        reason: 'token-mismatch',
      },
    });
  }

  return buildPolicy({
    principalId: 'authorized-client',
    effect: 'Allow',
    resource: methodArn,
    context: {
      authMode: 'shared-token',
      stage: process.env.STAGE_NAME || 'dev',
    },
  });
};
