import { HttpError } from '@aws-ddd-api/shared/auth/context';
import { logWarn } from '@aws-ddd-api/shared/logging/logger';
import env from '../config/env';

interface OrderWhatsAppParams {
  phoneNumber: string;
  lastName: string;
  option: string;
  tempId: string;
  lang?: string;
}

function formatWhatsAppAuthorizationHeader(value: string | undefined): string {
  const token = (value ?? '').trim();
  if (!token) return '';
  return /^Bearer\s+/i.test(token) ? token : `Bearer ${token}`;
}

function maskPhone(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length <= 4) return digits;
  return `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;
}

function truncateForLog(value: string, max = 2000): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...[truncated ${value.length - max} chars]`;
}

/**
 * Sends a WhatsApp template message to the customer after order creation.
 * Non-fatal — caller wraps in try/catch.
 */
export async function sendWhatsAppOrderMessage(
  order: OrderWhatsAppParams,
  newOrderVerificationId: unknown
): Promise<void> {
  const { phoneNumber, lastName, option, tempId, lang } = order;
  if (!phoneNumber) return;

  const token = formatWhatsAppAuthorizationHeader(env.WHATSAPP_BEARER_TOKEN);
  if (!token) return;
  const tokenScheme = token.split(/\s+/, 1)[0] ?? '';

  const templateName = lang === 'chn' ? 'ptag_order_chn' : 'ptag_order_eng';
  const templateLanguageCode = lang === 'chn' ? 'zh_CN' : 'en';
  const targetPhone = `+852${phoneNumber}`;
  const data = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: targetPhone,
    type: 'template',
    template: {
      name: templateName,
      language: { code: templateLanguageCode },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: lastName },
            { type: 'text', text: option === 'PTagAir' ? 'Ptag Air' : 'PTag' },
            { type: 'text', text: tempId },
          ],
        },
        {
          type: 'button',
          sub_type: 'url',
          index: 0,
          parameters: [{ type: 'text', text: String(newOrderVerificationId) }],
        },
      ],
    },
  };

  let response: Response;
  try {
    response = await fetch(
      `https://graph.facebook.com/v22.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token,
        },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(4000),
      }
    );
  } catch (error) {
    logWarn('WhatsApp provider request failed before response', {
      scope: 'commerce-orders.utils.whatsapp',
      error,
      extra: {
        phoneNumberMasked: maskPhone(phoneNumber),
        tempId,
        option,
        templateName,
        templateLanguageCode,
        phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
        authorizationScheme: tokenScheme,
      },
    });
    throw new HttpError('common.serviceUnavailable', 502);
  }

  const responseBody = await response.text().catch((error) => {
    logWarn('WhatsApp provider response body read failed', {
      scope: 'commerce-orders.utils.whatsapp',
      error,
      extra: {
        statusCode: response.status,
        statusText: response.statusText,
        phoneNumberMasked: maskPhone(phoneNumber),
        tempId,
      },
    });
    return '';
  });

  let parsedBody: unknown = null;
  if (responseBody) {
    try {
      parsedBody = JSON.parse(responseBody);
    } catch {
      parsedBody = null;
    }
  }

  if (!response.ok) {
    const providerError =
      parsedBody && typeof parsedBody === 'object' ? (parsedBody as { error?: unknown }).error : undefined;
    logWarn('WhatsApp provider rejected order notification', {
      scope: 'commerce-orders.utils.whatsapp',
      extra: {
        statusCode: response.status,
        statusText: response.statusText,
        phoneNumberMasked: maskPhone(phoneNumber),
        tempId,
        option,
        templateName,
        templateLanguageCode,
        phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
        authorizationScheme: tokenScheme,
        responseHeaders: Object.fromEntries(response.headers.entries()),
        responseBody: truncateForLog(responseBody, 3000),
        providerError,
        verificationId: String(newOrderVerificationId),
      },
    });
    throw new HttpError('common.serviceUnavailable', 502);
  }
}
