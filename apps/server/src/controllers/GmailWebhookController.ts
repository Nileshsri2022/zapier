import { Request, Response } from 'express';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { processGmailTrigger } from './GmailTriggersController';
import { processHistoryDelta, resolveGmailServersByEmail } from '../services/GmailDispatch';

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
  // Legacy custom-relay fields. Real Gmail watch notifications contain
  // ONLY emailAddress + historyId (spec audit B2) — eventType/messageId
  // are present only when an enriching relay produced them.
  eventType?: 'new_email' | 'label_added' | 'label_removed' | 'starred' | 'unstarred' | 'moved';
  messageId?: string;
  threadId?: string;
  labelIds?: string[];
}

import { verifyGmailPush } from '@repo/ingress';

const oidcClient = new OAuth2Client();

/**
 * Authenticate a Gmail push delivery. Two accepted credentials
 * (reports/gmail-worker-routing-spec.md §4.4/§8):
 *
 * 1. Pub/Sub OIDC (real Google push subscriptions): an
 *    `Authorization: Bearer <JWT>` whose signature/issuer verify, whose
 *    audience matches GMAIL_PUBSUB_AUDIENCE when configured, and whose
 *    email claim matches GMAIL_PUBSUB_SERVICE_ACCOUNT when configured.
 * 2. Legacy HMAC (`x-goog-signature` + GMAIL_WEBHOOK_SECRET) for any
 *    pre-existing custom relay — kept only until the P1 probe confirms
 *    nothing depends on it, then removed.
 *
 * Fails closed: no recognized valid credential => false.
 */
export async function verifyGmailPushAuth(req: Request): Promise<boolean> {
  const authorization = req.headers.authorization;

  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    const idToken = authorization.slice('Bearer '.length).trim();
    try {
      const ticket = await oidcClient.verifyIdToken({
        idToken,
        audience: process.env.GMAIL_PUBSUB_AUDIENCE || undefined,
      });
      const payload = ticket.getPayload();

      if (!payload || payload.email_verified !== true || !payload.email) return false;
      const expectedAccount = process.env.GMAIL_PUBSUB_SERVICE_ACCOUNT;
      if (expectedAccount && payload.email !== expectedAccount) return false;
      return true;
    } catch (error) {
      console.warn(
        'Gmail Pub/Sub OIDC verification failed:',
        error instanceof Error ? error.message : error
      );
      return false;
    }
  }

  // Legacy path — real Pub/Sub never sends this header.
  return verifyGmailWebhookSignature(req);
}

/**
 * Handle Gmail push notifications.
 *
 * Two payload shapes converge on the same dispatch:
 * - Real Gmail watch: { emailAddress, historyId } — the changed
 *   messages are discovered via history.list (processHistoryDelta).
 * - Legacy custom relay: enriched eventType/messageId fields — handled
 *   by the per-event handlers below, unchanged.
 */
export const handleGmailWebhook = async (req: Request, res: Response): Promise<any> => {
  try {
    const notification: GmailNotification = req.body;

    if (!(await verifyGmailPushAuth(req))) {
      console.warn('Invalid Gmail webhook credentials');
      return res.status(401).json({ message: 'Invalid signature' });
    }

    if (!notification?.message?.data) {
      return res.status(400).json({ message: 'Malformed Pub/Sub envelope' });
    }

    let notificationData: GmailNotificationData;
    try {
      notificationData = JSON.parse(
        Buffer.from(notification.message.data, 'base64').toString('utf-8')
      );
    } catch {
      // A body that can never parse would poison-loop on redelivery.
      return res.status(400).json({ message: 'Undecodable notification data' });
    }

    console.log('Received Gmail notification:', {
      eventType: notificationData.eventType,
      messageId: notificationData.messageId,
      threadId: notificationData.threadId,
      historyId: notificationData.historyId,
    });

    // Real Gmail watch shape: no eventType — resolve the delta first.
    if (!notificationData.eventType) {
      await handleHistoryNotification(notificationData);
      return res.status(200).json({ message: 'OK' });
    }

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
 * Real Gmail watch notifications: identify changed messages through the
 * history delta for each server connected to the notified mailbox.
 * Errors propagate (→ HTTP 500 → Pub/Sub redelivers; dedup makes the
 * retry safe).
 */
const handleHistoryNotification = async (data: GmailNotificationData): Promise<void> => {
  if (!data.emailAddress || !data.historyId) {
    console.warn('Gmail history notification missing emailAddress/historyId');
    return;
  }

  const servers = await resolveGmailServersByEmail(data.emailAddress);
  if (servers.length === 0) {
    // Mailbox not connected (or email not backfilled yet) — ack so the
    // provider does not retry a notification we can never route.
    console.log(`📬 No connected GmailServer for ${data.emailAddress}; notification dropped`);
    return;
  }

  for (const server of servers) {
    await processHistoryDelta(server, String(data.historyId));
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
const handleLabelNotification = async (
  data: GmailNotificationData,
  action: 'added' | 'removed'
): Promise<void> => {
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
const handleStarNotification = async (
  data: GmailNotificationData,
  starred: boolean
): Promise<void> => {
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
 * Verify the legacy Gmail HMAC (`x-goog-signature` + GMAIL_WEBHOOK_SECRET).
 *
 * Q8/Q11: the HMAC covers the *raw request bytes*, not a re-serialized body.
 * Hashing `JSON.stringify(req.body)` reorders/loses whitespace, so a relay
 * that signed exactly what it sent could never match. Fails closed.
 */
export const verifyGmailWebhookSignature = (req: Request): boolean => {
  const rawBytes = (req as any).rawBody as Buffer | undefined;
  const verdict = verifyGmailPush(
    {
      headers: req.headers as Record<string, string | string[] | undefined>,
      rawBody: rawBytes ? rawBytes.toString('utf8') : undefined,
      body: req.body,
    },
    process.env.GMAIL_WEBHOOK_SECRET
  );
  if (!verdict.ok) {
    console.error(`Gmail push delivery refused: ${verdict.code} — ${verdict.message}`);
  }
  return verdict.ok;
};

// Watch renewal used to be a TODO stub here. It is implemented as
// renewExpiringGmailWatches() in services/GmailDispatch and exposed via
// GET /api/cron/renew-gmail-watches (reports/gmail-worker-routing-spec.md §4.4).
