import env from './env';

type TwilioVerifyClient = {
  verify: {
    v2: {
      services: (serviceSid: string) => {
        verifications: {
          create: (options: { to: string; channel: 'sms' }) => Promise<unknown>;
        };
        verificationChecks: {
          create: (options: { to: string; code: string }) => Promise<{ status: string }>;
        };
      };
    };
  };
};

type TwilioFactory = (accountSid: string, authToken: string) => TwilioVerifyClient;

// Lazily load the Twilio SDK on first use. The SDK is ~18 MB and is only
// needed by /auth/challenges* routes; deferring the import keeps it out of
// the auth function's cold-start init path entirely. With esbuild CJS
// bundling the dynamic import compiles to a deferred `require`, so the
// SDK's top-level code does not execute until this getter is first awaited.
let clientPromise: Promise<TwilioVerifyClient> | undefined;

async function getTwilioClient(): Promise<TwilioVerifyClient> {
  if (!clientPromise) {
    clientPromise = import('twilio').then((mod) => {
      const factory = ((mod as { default?: TwilioFactory }).default ?? mod) as TwilioFactory;
      return factory(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
    });
  }
  return clientPromise;
}

export async function createSmsVerification(phoneNumber: string) {
  const client = await getTwilioClient();
  return client.verify.v2.services(env.TWILIO_VERIFY_SERVICE_SID).verifications.create({
    to: phoneNumber,
    channel: 'sms',
  });
}

export async function checkSmsVerification(params: {
  phoneNumber: string;
  code: string;
}) {
  const client = await getTwilioClient();
  return client.verify.v2.services(env.TWILIO_VERIFY_SERVICE_SID).verificationChecks.create({
    to: params.phoneNumber,
    code: params.code,
  });
}
