import { Request, Response } from 'express';
import client from '@repo/db';
import kafka from '@repo/kafka';

const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'zapmate_whatsapp_verify';

/**
 * Webhook verification (GET request from Meta)
 * Meta sends this to verify your endpoint
 */
export async function verifyWhatsAppWebhook(req: Request, res: Response): Promise<any> {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('WhatsApp webhook verification request:', { mode, token: token ? '***' : 'missing' });

  if (mode === 'subscribe' && token === WHATSAPP_VERIFY_TOKEN) {
    console.log('✅ WhatsApp webhook verified successfully');
    return res.status(200).send(challenge);
  }

  console.warn('❌ WhatsApp webhook verification failed');
  return res.status(403).json({ error: 'Verification failed' });
}

/**
 * Handle incoming WhatsApp messages (POST request from Meta)
 */
export async function handleWhatsAppWebhook(req: Request, res: Response): Promise<any> {
  try {
    const body = req.body;

    // Always respond 200 quickly to acknowledge receipt
    // Meta expects quick response, process async if needed

    // Verify it's a WhatsApp message
    if (body.object !== 'whatsapp_business_account') {
      return res.sendStatus(200);
    }

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    // Check if this is a message event
    if (!value?.messages?.[0]) {
      // Could be status update, delivery receipt, etc.
      console.log('WhatsApp webhook: Non-message event received');
      return res.sendStatus(200);
    }

    const message = value.messages[0];
    const contact = value.contacts?.[0];
    const phoneNumberId = value.metadata?.phone_number_id;

    console.log(`📱 WhatsApp message received from ${message.from}`);

    // Process the message asynchronously
    processWhatsAppMessage(phoneNumberId, message, contact).catch((error) => {
      console.error('Error processing WhatsApp message:', error);
    });

    // Respond immediately to Meta
    return res.sendStatus(200);
  } catch (error) {
    console.error('WhatsApp webhook error:', error);
    // Still return 200 to prevent Meta from retrying
    return res.sendStatus(200);
  }
}

/**
 * Process WhatsApp message and trigger Zaps
 */
async function processWhatsAppMessage(
  phoneNumberId: string,
  message: any,
  contact: any
): Promise<void> {
  try {
    // Find active triggers for this phone number
    const triggers = await client.whatsAppTrigger.findMany({
      where: {
        isActive: true,
        server: {
          phoneNumberId: phoneNumberId,
          isActive: true,
        },
      },
      include: {
        server: true,
      },
    });

    if (triggers.length === 0) {
      console.log('No active WhatsApp triggers for phone number:', phoneNumberId);
      return;
    }

    console.log(`Found ${triggers.length} active WhatsApp trigger(s)`);

    // Process each trigger
    for (const trigger of triggers) {
      if (!trigger.zapId) continue;

      const zap = await client.zap.findFirst({
        where: {
          id: trigger.zapId,
          isActive: true,
        },
      });

      if (!zap) continue;

      // Create ZapRun with message metadata
      const zapRun = await client.zapRun.create({
        data: {
          zapId: zap.id,
          metadata: {
            // Sender info
            from: message.from,
            fromName: contact?.profile?.name || message.from,
            // Message info
            messageId: message.id,
            timestamp: message.timestamp,
            type: message.type,
            // Message content based on type
            text: message.text?.body || '',
            // For media messages
            mediaId:
              message.image?.id || message.audio?.id || message.video?.id || message.document?.id,
            caption: message.image?.caption || message.video?.caption,
            // Server info
            phoneNumberId: phoneNumberId,
            // Useful placeholders
            email: `${message.from}@whatsapp.placeholder`,
          },
        },
      });

      // Update last processed time
      await client.whatsAppTrigger.update({
        where: { id: trigger.id },
        data: { lastProcessedAt: new Date() },
      });

      // Push to Kafka for processing
      const producer = kafka.producer();
      await producer.connect();
      await producer.send({
        topic: 'zap-events',
        messages: [
          {
            value: JSON.stringify({
              zapRunId: zapRun.id,
              stage: 1,
            }),
          },
        ],
      });
      await producer.disconnect();

      console.log(`✅ WhatsApp ZapRun created: ${zapRun.id} for Zap ${zap.id}`);
    }
  } catch (error) {
    console.error('Error processing WhatsApp message:', error);
    throw error;
  }
}
