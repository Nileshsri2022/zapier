import { Request, Response } from 'express';
import crypto from 'crypto';
import { processGmailTrigger } from './GmailTriggersController';

export interface GmailNotification {
  message: {
    data: string; // Base64 encoded notification data
    messageId: string;
    publishTime: string;
  };
  subscription: string;
}

export interface GmailNotificationData {
  emailAddress: string;
  historyId: string;
  eventType: 'new_email' | 'label_added' | 'label_removed' | 'starred' | 'unstarred' | 'moved';
  messageId?: string;
  threadId?: string;
  labelIds?: string[];
}

/**
 * Handle Gmail push notifications
 */
export const handleGmailWebhook = async (req: Request, res: Response): Promise<any> => {
  try {
    const notification: GmailNotification = req.body;

    // Verify webhook signature for security
    if (!verifyGmailWebhookSignature(req.headers, req.body)) {
      console.warn('Invalid Gmail webhook signature');
      return res.status(401).json({ message: 'Invalid signature' });
    }

    // Decode notification data
    const notificationData: GmailNotificationData = JSON.parse(
      Buffer.from(notification.message.data, 'base64').toString('utf-8')
    );

    console.log('Received Gmail notification:', {
      eventType: notificationData.eventType,
      messageId: notificationData.messageId,
      threadId: notificationData.threadId,
    });

    // Process the notification based on event type
    switch (notificationData.eventType) {
      case 'new_email':
        await handleNewEmailNotification(notificationData);
        break;
      case 'label_added':
        await handleLabelNotification(notificationData, 'added');
        break;
      case 'label_removed':
        await handleLabelNotification(notificationData, 'removed');
        break;
      case 'starred':
        await handleStarNotification(notificationData, true);
        break;
      case 'unstarred':
        await handleStarNotification(notificationData, false);
        break;
      case 'moved':
        await handleMoveNotification(notificationData);
        break;
      default:
        console.log('Unhandled Gmail notification type:', notificationData.eventType);
    }

    return res.status(200).json({ message: 'OK' });
  } catch (error) {
    console.error('Error handling Gmail webhook:', error);
    return res.status(500).json({
      message: 'Error processing Gmail notification',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Handle new email notifications
 */
const handleNewEmailNotification = async (data: GmailNotificationData): Promise<void> => {
  if (!data.messageId) {
    console.warn('New email notification missing messageId');
    return;
  }

  try {
    // Process Gmail triggers for this server
    await processGmailTrigger(data.emailAddress, {
      id: data.messageId,
      threadId: data.threadId,
      eventType: 'new_email',
      timestamp: new Date(),
    });
  } catch (error) {
    console.error('Error processing new email trigger:', error);
  }
};

/**
 * Handle label notifications
 */
const handleLabelNotification = async (data: GmailNotificationData, action: 'added' | 'removed'): Promise<void> => {
  if (!data.messageId || !data.labelIds) {
    console.warn('Label notification missing required data');
    return;
  }

  try {
    await processGmailTrigger(data.emailAddress, {
      id: data.messageId,
      threadId: data.threadId,
      eventType: action === 'added' ? 'label_added' : 'label_removed',
      labelIds: data.labelIds,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error('Error processing label trigger:', error);
  }
};

/**
 * Handle star notifications
 */
const handleStarNotification = async (data: GmailNotificationData, starred: boolean): Promise<void> => {
  if (!data.messageId) {
    console.warn('Star notification missing messageId');
    return;
  }

  try {
    await processGmailTrigger(data.emailAddress, {
      id: data.messageId,
      threadId: data.threadId,
      eventType: starred ? 'starred' : 'unstarred',
      starred,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error('Error processing star trigger:', error);
  }
};

/**
 * Handle move notifications
 */
const handleMoveNotification = async (data: GmailNotificationData): Promise<void> => {
  if (!data.messageId) {
    console.warn('Move notification missing messageId');
    return;
  }

  try {
    await processGmailTrigger(data.emailAddress, {
      id: data.messageId,
      threadId: data.threadId,
      eventType: 'moved',
      timestamp: new Date(),
    });
  } catch (error) {
    console.error('Error processing move trigger:', error);
  }
};

/**
 * Verify Gmail webhook signature
 */
export const verifyGmailWebhookSignature = (headers: any, body: any): boolean => {
  try {
    const signature = headers['x-goog-signature'] as string;
    if (!signature) {
      return false;
    }

    // Gmail signs the message with HMAC-SHA256
    const secret = process.env.GMAIL_WEBHOOK_SECRET;
    if (!secret) {
      console.warn('GMAIL_WEBHOOK_SECRET not configured, skipping signature verification');
      return true; // Allow in development
    }

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(body))
      .digest('hex');

    return signature === expectedSignature;
  } catch (error) {
    console.error('Error verifying Gmail webhook signature:', error);
    return false;
  }
};

/**
 * Renew Gmail watch subscription before it expires
 */
export const renewGmailWatch = async (serverId: string): Promise<void> => {
  try {
    // This would be called by a scheduled job
    // Implementation would depend on your GmailService
    console.log(`Renewing Gmail watch for server: ${serverId}`);
    // TODO: Implement watch renewal logic
  } catch (error) {
    console.error('Error renewing Gmail watch:', error);
  }
};
