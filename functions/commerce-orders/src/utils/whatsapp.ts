import env from '../config/env';

interface OrderWhatsAppParams {
  phoneNumber: string;
  lastName: string;
  option: string;
  tempId: string;
  lang?: string;
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

  const token = env.WHATSAPP_BEARER_TOKEN;
  if (!token) return;

  const data = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: `+852${phoneNumber}`,
    type: 'template',
    template: {
      name: lang === 'chn' ? 'ptag_order_chn' : 'ptag_order_eng',
      language: { code: lang === 'chn' ? 'zh_CN' : 'en' },
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

  const response = await fetch(
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

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`WhatsApp API error: ${response.status} ${errorBody}`);
  }
}


