import { Request, Response } from 'express';
import crypto from 'crypto';
import client from '@repo/db';
import { enqueueRun } from '@repo/runs';

/**
 * WhatsApp Cloud API webhook — T6 spec (docs/ask-matt/triggers/whatsapp.md,
 * round 8).
 *
 * - E1 inbound messages ONLY; status/template callbacks ack'd with 200 and
 *   no run (E2/E3 backlog).
 * - Signature (Q-WA-T-04): X-Hub-Signature-256 validation with the app
 *   secret is MANDATORY — missing secret config, missing header or a bad
 *   signature always reject (401 + security log), never a run.
 * - GET verification challenge echoes hub.challenge on token match.
 * - Phone-number-id filter (Q-WA-T-05): runs only fire for Zaps whose
 *   WhatsAppServer binds the payload's phone_number_id — mismatch acks
 *   without a run.
 * - Contract §4: event/messageId/from/fromProfileName/chatId/phoneNumberId/
 *   timestamp (ISO)/type/text{body}/media{id,mimeType,filename,sha256,caption}/
 *   caption/raw + legacy aliases (fromName, mediaId, email placeholder).
 * - Meta retries → dedupe on messageId (scope 'whatsapp').
 * - Unknown type → forwarded as 'unknown' with raw intact; every message in
 *   the payload (entries × changes × messages batches) produces its own run.
 * - App secret source: env WHATSAPP_APP_SECRET (shared per-provider
 *   credential, Q-X-03). The schema has no appSecret column; adding one is a
 *   migration deferred with the connection-UX work — logged in grill log T6.
 */

const VERIFY_TOKEN_FALLBACK = 'zapmate_whatsapp_verify';

const KNOWN_TYPES = new Set([
  'text',
  'image',
  'audio',
  'video',
  'document',
  'sticker',
  'location',
  'contacts',
  'interactive',
  'button',
]);

/** Webhook verification (GET request from Meta) — echoes hub.challenge. */
export async function verifyWhatsAppWebhook(req: Request, res: Response): Promise<any> {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const expected =
    process.env.WHATSAPP_VERIFY_TOKEN?.trim() || VERIFY_TOKEN_FALLBACK;

  console.log('WhatsApp webhook verification request:', { mode, token: token ? '***' : 'missing' });

  if (mode === 'subscribe' && token === expected) {
    console.log('✅ WhatsApp webhook verified successfully');
    return res.status(200).send(challenge);
  }

  console.warn('❌ WhatsApp webhook verification failed');
  return res.status(403).json({ error: 'Verification failed' });
}

/** Mandatory X-Hub-Signature-256 check (Q-WA-T-04), fail closed. */
export function verifyWhatsAppSignature(
  headers: Record<string, string | string[] | undefined>,
  rawBody: string
): { ok: boolean; reason?: string } {
  const appSecret = process.env.WHATSAPP_APP_SECRET?.trim();
  if (!appSecret) {
    return { ok: false, reason: 'WHATSAPP_APP_SECRET not configured — signature cannot be verified' };
  }
  const header = headers['x-hub-signature-256'];
  const signature = (Array.isArray(header) ? header[0] : header) || '';
  if (!signature) {
    return { ok: false, reason: 'Missing X-Hub-Signature-256 header' };
  }
  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  try {
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { ok: false, reason: 'Invalid signature' };
    }
  } catch {
    return { ok: false, reason: 'Invalid signature' };
  }
  return { ok: true };
}

/** §4 type enum — unrecognized API types normalize to 'unknown'. */
export function normalizeMessageType(type: unknown): string {
  const t = typeof type === 'string' ? type : '';
  return KNOWN_TYPES.has(t) ? t : 'unknown';
}

/** Media messages → §4 media metadata only (content fetch out of v1). */
function extractMedia(message: any): Record<string, any> | null {
  for (const kind of ['image', 'audio', 'video', 'document', 'sticker']) {
    const block = message?.[kind];
    if (block && typeof block === 'object') {
      return {
        id: block.id ?? null,
        mimeType: block.mime_type ?? null,
        filename: block.filename ?? null,
        sha256: block.sha256 ?? null,
        caption: block.caption ?? null,
      };
    }
  }
  return null;
}

/** §4 run contract (+ legacy aliases). */
export function buildWhatsAppRunPayload(
  message: any,
  contact: any,
  phoneNumberId: string,
  fullPayload: any
): Record<string, any> {
  const type = normalizeMessageType(message?.type);
  const media = extractMedia(message);
  const timestampRaw = message?.timestamp;
  const timestampIso =
    typeof timestampRaw === 'string' && /^\d+$/.test(timestampRaw)
      ? new Date(Number(timestampRaw) * 1000).toISOString()
      : typeof timestampRaw === 'number'
        ? new Date(timestampRaw * 1000).toISOString()
        : null;
  const from = message?.from || '';

  return {
    // Spec contract (§4)
    event: 'message',
    messageId: message?.id ?? null,
    from,
    fromProfileName: contact?.profile?.name || null,
    chatId: from,
    phoneNumberId,
    timestamp: timestampIso,
    type,
    text: message?.text ? { body: message.text.body ?? '' } : null,
    media,
    caption: media?.caption ?? null,
    raw: fullPayload,
    // Legacy aliases (existing templates/filters depend on these)
    fromName: contact?.profile?.name || from,
    mediaId: media?.id ?? undefined,
    email: `${from}@whatsapp.placeholder`,
  };
}

/**
 * Handle incoming WhatsApp messages (POST request from Meta).
 * Signature is verified BEFORE anything else; processing errors surface as
 * 5xx so Meta's retry policy redelivers (deduped on messageId).
 */
export async function handleWhatsAppWebhook(req: Request, res: Response): Promise<any> {
  try {
    const body = req.body;

    // ---- Mandatory signature (Q-WA-T-04) ----
    const rawBody =
      (req as any).rawBody?.toString('utf8') ??
      (body !== undefined ? JSON.stringify(body) : '');
    const sigCheck = verifyWhatsAppSignature(req.headers, rawBody);
    if (!sigCheck.ok) {
      console.error(`🔒 WhatsApp security: rejected delivery — ${sigCheck.reason}`);
      return res.status(401).json({ error: 'Signature verification failed' });
    }

    // Non-WhatsApp payloads: ack, nothing to do.
    if (body?.object !== 'whatsapp_business_account') {
      return res.sendStatus(200);
    }

    // Collect every message in the batch (entries × changes × messages).
    const batch: Array<{ message: any; contact: any; phoneNumberId: string }> = [];
    for (const entry of body.entry || []) {
      for (const change of entry?.changes || []) {
        const value = change?.value;
        if (!value?.messages?.length) continue; // status/template callbacks → ack only (E2)
        const phoneNumberId = value.metadata?.phone_number_id || '';
        for (const message of value.messages) {
          batch.push({
            message,
            contact: value.contacts?.[0],
            phoneNumberId,
          });
        }
      }
    }

    if (batch.length === 0) {
      console.log('WhatsApp webhook: Non-message event received');
      return res.sendStatus(200);
    }

    for (const item of batch) {
      console.log(`📱 WhatsApp message received from ${item.message.from}`);
      await processWhatsAppMessage(item.phoneNumberId, item.message, item.contact, body);
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error('WhatsApp webhook error:', error);
    // Non-2xx → Meta retries (queue, don't drop); messageId dedupe absorbs
    // the redelivery when the original actually landed.
    return res.status(500).json({ error: 'Processing failed' });
  }
}

/** Process one inbound message and fan out to matching Zaps. */
async function processWhatsAppMessage(
  phoneNumberId: string,
  message: any,
  contact: any,
  fullPayload: any
): Promise<void> {
  // Phone-number-id filter (Q-WA-T-05): only Zaps bound to this number id.
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

  for (const trigger of triggers) {
    if (!trigger.zapId) continue;

    // The run-intake module owns the active-Zap decision.
    const zap = await client.zap.findFirst({ where: { id: trigger.zapId } });
    if (!zap) continue;

    const result = await enqueueRun({
      zapId: zap.id,
      source: 'hooks.whatsapp',
      // Meta redelivers on non-2xx → dedupe on messageId (non-negotiable).
      dedup: { scope: 'whatsapp', key: `${zap.id}:${message.id}` },
      metadata: buildWhatsAppRunPayload(message, contact, phoneNumberId, fullPayload),
    });

    if (result.status !== 'queued') {
      // Only a real run advances the trigger clock.
      console.log(`🔁 WhatsApp ${result.status} — no run for Zap ${zap.id}`);
      continue;
    }

    await client.whatsAppTrigger.update({
      where: { id: trigger.id },
      data: { lastProcessedAt: new Date() },
    });

    console.log(`✅ WhatsApp ZapRun queued: ${result.zapRunId} for Zap ${zap.id}`);
  }
}
