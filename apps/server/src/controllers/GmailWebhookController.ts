import { Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { verifyGmailPush } from '@repo/ingress';
import { intakeGmailDelivery, type GmailDelivery } from '../services/gmailIntake';

/**
 * Gmail push ingress. Its whole job is the wire contract: authenticate the
 * delivery, decode the Pub/Sub envelope, and hand intake one typed
 * `GmailDelivery`. Routing, hydration, matching and dedup live in
 * `services/gmailIntake.ts` — nothing here touches Gmail or the run tables.
 */

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
  historyId?: string;
  // Legacy custom-relay fields. Real Gmail watch notifications contain
  // ONLY emailAddress + historyId (spec audit B2) — eventType/messageId
  // are present only when an enriching relay produced them.
  eventType?: 'new_email' | 'label_added' | 'label_removed' | 'starred' | 'unstarred' | 'moved';
  messageId?: string;
  threadId?: string;
  labelIds?: string[];
  starred?: boolean;
}

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
 * Decode the notification payload into intake's union.
 *
 * Returns null for a body that names no mailbox, or one that claims to be a
 * watch notification without a cursor. Both are acknowledged without
 * routing: a redelivery would carry the same unusable body, so failing the
 * request would only loop.
 */
function toDelivery(data: GmailNotificationData): GmailDelivery | null {
  if (!data?.emailAddress) {
    console.warn('Gmail notification carries no emailAddress');
    return null;
  }

  // Legacy relay shape: an eventType means the relay already identified the
  // message, so there is no history delta to read (ADR-0005).
  if (data.eventType) {
    return {
      source: 'legacy',
      emailAddress: data.emailAddress,
      event: {
        eventType: data.eventType,
        messageId: data.messageId,
        threadId: data.threadId,
        labelIds: data.labelIds,
        starred: data.starred,
      },
    };
  }

  if (!data.historyId) {
    console.warn('Gmail history notification missing historyId', {
      emailAddress: data.emailAddress,
    });
    return null;
  }

  return {
    source: 'pubsub',
    emailAddress: data.emailAddress,
    historyId: String(data.historyId),
  };
}

/**
 * Handle Gmail push notifications.
 *
 * Errors propagate (→ HTTP 500 → Pub/Sub redelivers; the dedup claims inside
 * intake make the retry safe).
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

    const delivery = toDelivery(notificationData);
    if (delivery) {
      const { runsEnqueued } = await intakeGmailDelivery(delivery);
      console.log('Gmail notification processed', {
        source: delivery.source,
        runsEnqueued,
      });
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

// Watch renewal and polling live in services/gmailWatch.ts, exposed via
// GET /api/cron/renew-gmail-watches and GET /api/cron/poll-gmail
// (reports/gmail-worker-routing-spec.md §4.4).
