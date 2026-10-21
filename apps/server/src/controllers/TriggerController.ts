import client from '@repo/db';
import type { Request, Response } from 'express';
import { enqueueRun } from '@repo/runs';
import { verifyLegacyWebhook } from '@repo/ingress';

export const fetchAvailableTriggers = async (req: Request, res: Response): Promise<any> => {
  const avialableTriggers = await client.availableTriggers.findMany();

  return res.status(200).json({
    message: 'Fetched available triggers',
    avialableTriggers,
  });
};

/**
 * Legacy server webhook ingress (POST /api/triggers/webhook/:zapId).
 *
 * As of gmail-worker-routing-spec P5 this no longer executes actions in
 * this process (the server-inline executor is deleted): like every other
 * ingress it durably enqueues ZapRun + ZapRunOutbox (in one transaction)
 * and apps/worker runs the Zap. Response contract is unchanged — 200 once
 * the run is durably queued (or when the Zap is missing/inactive, so
 * providers don't retry-loop), 401 on bad signature, 400 without zapId.
 * Run outcomes now surface via ZapRun status + the worker's failure
 * email, exactly like the primary hooks-service webhook.
 */
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
    // Legacy policy preserved verbatim (Q1): this endpoint is signature-checked
    // only when WEBHOOK_SECRET is configured. The check itself belongs to the
    // engine — the status and message mapping stays here so the wire contract
    // is unchanged.
    if (process.env.WEBHOOK_SECRET) {
      const rawBody = (req as any).rawBody?.toString('utf8') ?? JSON.stringify(payload);
      const verdict = verifyLegacyWebhook(rawBody, signature, process.env.WEBHOOK_SECRET);
      if (!verdict.ok) {
        return res.status(verdict.status).json({
          message:
            verdict.code === 'MISSING_CREDENTIAL'
              ? 'Webhook signature required'
              : 'Invalid webhook signature',
        });
      }
    }

    // Opt-in dedup parity with the hooks ingress (same scope/key shape,
    // so an event delivered to both URLs still fires only once).
    const eventId =
      typeof payload?.event_id === 'string'
        ? payload.event_id
        : typeof payload?.eventId === 'string'
          ? payload.eventId
          : undefined;
    const result = await enqueueRun({
      zapId: zapId as string,
      metadata: payload,
      source: 'server.webhook',
      dedup: {
        scope: 'webhook',
        key: eventId ? `${zapId}:${eventId}` : undefined,
      },
    });

    if (result.status === 'duplicate') {
      return res.status(200).json({
        message: 'Duplicate event skipped',
        timestamp: new Date().toISOString(),
      });
    }

    if (result.status === 'skipped') {
      console.log(`Zap ${zapId} ${result.reason} — webhook acknowledged without a run`);
      return res.status(200).json({
        message: 'Webhook processed successfully',
        timestamp: new Date().toISOString(),
      });
    }

    console.log(`📝 ZapRun queued: ${result.zapRunId} (legacy server webhook)`);
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
