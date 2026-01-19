import axios from 'axios';

const TELEGRAM_API = 'https://api.telegram.org/bot';

export interface TelegramMessageResult {
  success: boolean;
  messageId?: number;
  error?: string;
}

/**
 * Send a text message via Telegram Bot API
 */
export async function sendTelegramMessage(
  botToken: string,
  chatId: string | number,
  text: string,
  parseMode: 'HTML' | 'Markdown' | 'MarkdownV2' = 'HTML'
): Promise<TelegramMessageResult> {
  try {
    console.log(`📤 Sending Telegram message to chat ${chatId}...`);

    const response = await axios.post(`${TELEGRAM_API}${botToken}/sendMessage`, {
      chat_id: chatId,
      text: text,
      parse_mode: parseMode,
    });

    const messageId = response.data.result.message_id;
    console.log(`✅ Telegram message sent successfully: ${messageId}`);

    return {
      success: true,
      messageId,
    };
  } catch (error: any) {
    const errorMsg = error.response?.data?.description || error.message;
    console.error(`❌ Telegram send error: ${errorMsg}`);
    return {
      success: false,
      error: errorMsg,
    };
  }
}

/**
 * Send a photo via Telegram Bot API
 */
export async function sendTelegramPhoto(
  botToken: string,
  chatId: string | number,
  photoUrl: string,
  caption?: string
): Promise<TelegramMessageResult> {
  try {
    console.log(`📸 Sending Telegram photo to chat ${chatId}...`);

    const response = await axios.post(`${TELEGRAM_API}${botToken}/sendPhoto`, {
      chat_id: chatId,
      photo: photoUrl,
      caption: caption,
    });

    return {
      success: true,
      messageId: response.data.result.message_id,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.response?.data?.description || error.message,
    };
  }
}

/**
 * Send a document via Telegram Bot API
 */
export async function sendTelegramDocument(
  botToken: string,
  chatId: string | number,
  documentUrl: string,
  caption?: string
): Promise<TelegramMessageResult> {
  try {
    const response = await axios.post(`${TELEGRAM_API}${botToken}/sendDocument`, {
      chat_id: chatId,
      document: documentUrl,
      caption: caption,
    });

    return {
      success: true,
      messageId: response.data.result.message_id,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.response?.data?.description || error.message,
    };
  }
}

/**
 * Reply to a specific message
 */
export async function replyToMessage(
  botToken: string,
  chatId: string | number,
  replyToMessageId: number,
  text: string
): Promise<TelegramMessageResult> {
  try {
    const response = await axios.post(`${TELEGRAM_API}${botToken}/sendMessage`, {
      chat_id: chatId,
      text: text,
      reply_to_message_id: replyToMessageId,
    });

    return {
      success: true,
      messageId: response.data.result.message_id,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.response?.data?.description || error.message,
    };
  }
}
