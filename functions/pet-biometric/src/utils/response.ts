import { createResponse } from '@aws-ddd-api/shared';
import en from '../locales/en.json';
import zh from '../locales/zh.json';

export const response = createResponse({
  domainTranslations: { en, zh },
  scope: 'pet-biometric.response',
});
