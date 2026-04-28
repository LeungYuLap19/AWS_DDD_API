import env from './env';

declare const require: (moduleName: string) => any;

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

const createTwilioClient = require('twilio') as (
  accountSid: string,
  authToken: string
) => TwilioVerifyClient;

export const twilioClient = createTwilioClient(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

export async function createSmsVerification(phoneNumber: string) {
  return twilioClient.verify.v2.services(env.TWILIO_VERIFY_SERVICE_SID).verifications.create({
    to: phoneNumber,
    channel: 'sms',
  });
}

export async function checkSmsVerification(params: {
  phoneNumber: string;
  code: string;
}) {
  return twilioClient.verify.v2.services(env.TWILIO_VERIFY_SERVICE_SID).verificationChecks.create({
    to: params.phoneNumber,
    code: params.code,
  });
}
