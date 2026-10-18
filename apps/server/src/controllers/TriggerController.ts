import client from '@repo/db';
import type { Request, Response } from 'express';
import crypto from 'crypto';
import { processWebhookTrigger } from './ZapController';

export const fetchAvailableTriggers = async (req: Request, res: Response): Promise<any> => {
  const avialableTriggers = await client.availableTriggers.findMany();

  return res.status(200).json({
    message: 'Fetched available triggers',
    avialableTriggers,
  });
};

export const handleWebhook = async (req: Request, res: Response): Promise<any> => {
  try {
    const { zapId } = req.params;
    const payload = req.body;
    const signature = req.headers['x-webhook-signature'] as string;

    if (!zapId) {
      return res.status(400).json({ message: 'Zap ID is required' });
    }

    // When WEBHOOK_SECRET is configured, signatures are mandatory:
    // an absent signature must not silently bypass verification.
    if (process.env.WEBHOOK_SECRET) {
      if (!signature) {
        return res.status(401).json({ message: 'Webhook signature required' });
      }
      const isValidSignature = verifyWebhookSignature(JSON.stringify(payload), signature);
      if (!isValidSignature) {
        return res.status(401).json({ message: 'Invalid webhook signature' });
      }
    }

    // Process the webhook trigger
    await processWebhookTrigger(zapId as string, payload);

    return res.status(200).json({
      message: 'Webhook processed successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return res.status(500).json({
      message: 'Webhook processing failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

// NOTE: an unmounted `handleGmailTrigger` handler used to live here (it was
// exported but attached to no route, and called the second function named
// processGmailTrigger). Removed in gmail-worker-routing-spec P2 — Gmail
// events enter via GmailRoutes' /webhook and GmailTriggersController.

export const verifyWebhookSignature = (payload: string, signature: string): boolean => {
  try {
    // In a real implementation, you'd use a proper webhook secret
    // For now, we'll do a basic verification
    const secret = process.env.WEBHOOK_SECRET;
    if (!secret) {
      // No secret configured: nothing to verify against. Callers are
      // authenticated by the unguessable zapId in the URL (capability URL).
      return false;
    }

    const expectedSignature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    return signature === `sha256=${expectedSignature}`;
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
};
