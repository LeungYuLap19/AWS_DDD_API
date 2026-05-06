const fs = require('fs');

const env = JSON.parse(fs.readFileSync('env.development.json', 'utf8'));

const values = {
  DEV_ALLOWED_ORIGINS: env.Parameters.ALLOWED_ORIGINS,
  DEV_AUTH_BYPASS: env.Parameters.AUTH_BYPASS,
  DEV_MONGODB_URI: env.Parameters.MONGODB_URI,
  DEV_JWT_SECRET: env.RequestAuthorizerFunction.JWT_SECRET,
  DEV_REFRESH_TOKEN_MAX_AGE_SEC: env.AuthFunction.REFRESH_TOKEN_MAX_AGE_SEC,
  DEV_REFRESH_RATE_LIMIT_LIMIT: env.AuthFunction.REFRESH_RATE_LIMIT_LIMIT,
  DEV_REFRESH_RATE_LIMIT_WINDOW_SEC: env.AuthFunction.REFRESH_RATE_LIMIT_WINDOW_SEC,
  DEV_AUTH_SMTP_HOST: env.AuthFunction.SMTP_HOST,
  DEV_AUTH_SMTP_PORT: env.AuthFunction.SMTP_PORT,
  DEV_AUTH_SMTP_USER: env.AuthFunction.SMTP_USER,
  DEV_AUTH_SMTP_PASS: env.AuthFunction.SMTP_PASS,
  DEV_AUTH_SMTP_FROM: env.AuthFunction.SMTP_FROM,
  DEV_TWILIO_ACCOUNT_SID: env.AuthFunction.TWILIO_ACCOUNT_SID,
  DEV_TWILIO_AUTH_TOKEN: env.AuthFunction.TWILIO_AUTH_TOKEN,
  DEV_TWILIO_VERIFY_SERVICE_SID: env.AuthFunction.TWILIO_VERIFY_SERVICE_SID,
  DEV_S3_BUCKET_NAME: env.PetProfileFunction.AWS_BUCKET_NAME,
  DEV_S3_BUCKET_BASE_URL: env.PetProfileFunction.AWS_BUCKET_BASE_URL,
  DEV_S3_BUCKET_REGION: env.PetProfileFunction.AWS_BUCKET_REGION,
  DEV_ADOPTION_MONGODB_URI: env.PetAdoptionFunction.ADOPTION_MONGODB_URI,
  DEV_PET_ANALYSIS_VM_PUBLIC_IP: env.PetAnalysisFunction.VM_PUBLIC_IP,
  DEV_PET_ANALYSIS_DOCKER_IMAGE: env.PetAnalysisFunction.DOCKER_IMAGE,
  DEV_PET_ANALYSIS_HEATMAP: env.PetAnalysisFunction.HEATMAP,
  DEV_PET_ANALYSIS_VM_BREED_PUBLIC_IP: env.PetAnalysisFunction.VM_BREED_PUBLIC_IP,
  DEV_PET_ANALYSIS_BREED_DOCKER_IMAGE: env.PetAnalysisFunction.BREED_DOCKER_IMAGE,
  DEV_BUSINESS_MONGODB_URI: env.PetBiometricFunction.BUSINESS_MONGODB_URI,
  DEV_FACEID_API: env.PetBiometricFunction.FACEID_API,
  DEV_COMMERCE_SMTP_HOST: env.CommerceFulfillmentFunction.SMTP_HOST,
  DEV_COMMERCE_SMTP_PORT: env.CommerceFulfillmentFunction.SMTP_PORT,
  DEV_COMMERCE_SMTP_USER: env.CommerceFulfillmentFunction.SMTP_USER,
  DEV_COMMERCE_SMTP_PASS: env.CommerceFulfillmentFunction.SMTP_PASS,
  DEV_COMMERCE_SMTP_FROM: env.CommerceFulfillmentFunction.SMTP_FROM,
  DEV_WHATSAPP_BEARER_TOKEN: env.CommerceFulfillmentFunction.WHATSAPP_BEARER_TOKEN,
  DEV_WHATSAPP_PHONE_NUMBER_ID: env.CommerceFulfillmentFunction.WHATSAPP_PHONE_NUMBER_ID,
  DEV_CUTTLY_API_KEY: env.CommerceFulfillmentFunction.CUTTLY_API_KEY,
  DEV_SF_CUSTOMER_CODE: env.LogisticsFunction.SF_CUSTOMER_CODE,
  DEV_SF_PRODUCTION_CHECK_CODE: env.LogisticsFunction.SF_PRODUCTION_CHECK_CODE,
  DEV_SF_SANDBOX_CHECK_CODE: env.LogisticsFunction.SF_SANDBOX_CHECK_CODE,
  DEV_SF_ADDRESS_API_KEY: env.LogisticsFunction.SF_ADDRESS_API_KEY,
  DEV_LOGISTICS_SMTP_HOST: env.LogisticsFunction.SMTP_HOST,
  DEV_LOGISTICS_SMTP_PORT: env.LogisticsFunction.SMTP_PORT,
  DEV_LOGISTICS_SMTP_USER: env.LogisticsFunction.SMTP_USER,
  DEV_LOGISTICS_SMTP_PASS: env.LogisticsFunction.SMTP_PASS,
  DEV_LOGISTICS_SMTP_FROM: env.LogisticsFunction.SMTP_FROM,
};

function quote(value) {
  return `'${String(value ?? '').replace(/'/g, `'\\''`)}'`;
}

const lines = [
  '#!/usr/bin/env bash',
  'set -euo pipefail',
  '',
  'gh auth status >/dev/null',
  '',
];

for (const [name, value] of Object.entries(values)) {
  if (value === undefined || value === '') {
    lines.push(`echo "Skipping ${name}: empty value"`);
    continue;
  }
  lines.push(`gh secret set ${name} --body ${quote(value)}`);
}

fs.writeFileSync('script/set-github-dev-secrets.local.sh', `${lines.join('\n')}\n`, { mode: 0o700 });
console.log('Wrote set-github-dev-secrets.local.sh');
