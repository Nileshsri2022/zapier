import axios from 'axios';

const WHATSAPP_API_URL = 'https://graph.facebook.com/v18.0';
// Bound every call: a stalled Meta connection must not block a Kafka partition.
const REQUEST_TIMEOUT_MS = 10_000;

export interface WhatsAppMessageResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send a text message via WhatsApp Cloud API
 */
export async function sendWhatsAppMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  message: string
): Promise<WhatsAppMessageResult> {
  try {
    // Normalize phone number (remove +, spaces, etc. if present)
    const normalizedTo = to.replace(/[^0-9]/g, '');

    console.log(`📤 Sending WhatsApp message to ${normalizedTo}...`);

    const response = await axios.post(
      `${WHATSAPP_API_URL}/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: normalizedTo,
        type: 'text',
        text: {
          preview_url: true,
          body: message,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: REQUEST_TIMEOUT_MS,
      }
    );

    const messageId = response.data?.messages?.[0]?.id;
    console.log(`✅ WhatsApp message sent successfully: ${messageId}`);

    return {
      success: true,
      messageId,
    };
  } catch (error: any) {
    const errorMessage = error.response?.data?.error?.message || error.message;
    console.error('❌ WhatsApp send error:', errorMessage);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Send a template message via WhatsApp Cloud API
 * (Useful for first-time messages to users who haven't messaged in 24h)
 */
export async function sendWhatsAppTemplateMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  templateName: string,
  languageCode: string = 'en_US',
  components: any[] = []
): Promise<WhatsAppMessageResult> {
  try {
    const normalizedTo = to.replace(/[^0-9]/g, '');

    console.log(`📤 Sending WhatsApp template "${templateName}" to ${normalizedTo}...`);

    const response = await axios.post(
      `${WHATSAPP_API_URL}/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: normalizedTo,
        type: 'template',
        template: {
          name: templateName,
          language: { code: languageCode },
          components: components,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: REQUEST_TIMEOUT_MS,
      }
    );

    const messageId = response.data?.messages?.[0]?.id;
    console.log(`✅ WhatsApp template sent successfully: ${messageId}`);

    return {
      success: true,
      messageId,
    };
  } catch (error: any) {
    const errorMessage = error.response?.data?.error?.message || error.message;
    console.error('❌ WhatsApp template send error:', errorMessage);
    return {
      success: false,
      error: errorMessage,
    };
  }
}
