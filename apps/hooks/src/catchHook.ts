/**
 * T5 — Catch Hook ingress (docs/ask-matt/triggers/webhook.md, round 7).
 *
 * - V1 all five verbs (GET/POST/PUT/PATCH/DELETE), other verbs → 405.
 * - V2 separate test and production URLs: /hooks/test/:userId/:zapId/:testId
 *   stores samples (cap HOOK_SAMPLE_CAP) and never enqueues; production URLs
 *   are /hooks/:userId/:zapId (legacy) or /hooks/:userId/:zapId/:hookId once
 *   rotated — rotation via Trigger.metadata.prodHookId revokes the old URL
 *   immediately (410, no grace period).
 * - V3 fixed 200 + empty body for every successful ack (queued, duplicate,
 *   inactive).
 * - V4 per-hook auth: none / static key / HMAC (trigger.metadata.authMode), verified
 *   by @repo/ingress — see docs/adr/0002-ingress-verification-architecture.md.
 * - V5 JSON + x-www-form-urlencoded parsed, GET-style exposes query, all
 *   other content types (multipart, XML, …) → body null + bodyRaw. Body cap
 *   MAX_WEBHOOK_BYTES → 413, no run.
 * - V6 x-request-id dedupe (fallback: body event_id/eventId).
 * - §4 data contract: method/url/pathParams/query/headers/body/bodyRaw/
 *   receivedAt (+ legacy body fields spread at top level). Headers allowlisted
 *   with authorization/cookie redacted. OPTIONS preflight answered.
 */

import { Router, Request, Response, NextFunction } from 'express';
import client from '@repo/db';
import { enqueueRun } from '@repo/runs';
import { resolveAuthMode, resolveWebhookSecret, verifyCatchHook } from '@repo/ingress';

export const MAX_WEBHOOK_BYTES = 1_000_000; // 413 beyond this
export const HOOK_SAMPLE_CAP = 10;

const ACCEPTED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/** Spec §4: allowlist surfaced; secrets redacted by default. */
const HEADER_ALLOWLIST = new Set([
  'content-type',
  'content-length',
  'accept',
  'user-agent',
  'accept-encoding',
  'host',
  'x-request-id',
  'x-webhook-signature',
  'x-webhook-secret',
  'x-signature',
]);
const REDACTED_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-key']);

export function surfaceHeaders(
  headers: Record<string, string | string[] | undefined>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    const raw = Array.isArray(value) ? value.join(', ') : String(value ?? '');
    if (REDACTED_HEADERS.has(lower)) {
      out[lower] = '[redacted]';
      continue;
    }
    if (HEADER_ALLOWLIST.has(lower) || lower.startsWith('x-')) {
      out[lower] = raw;
    }
  }
  return out;
}

/** Spec §5: JSON parsed, form field map, everything else bodyRaw-only. */
export function parseHookBody(
  raw: Buffer | undefined,
  contentType: string | undefined
): { body: any; bodyRaw: string } {
  const bodyRaw = raw && raw.length ? raw.toString('utf8') : '';
  if (!bodyRaw) {
    return { body: {}, bodyRaw: '' };
  }
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('application/json') || ct.includes('+json')) {
    try {
      return { body: JSON.parse(bodyRaw), bodyRaw };
    } catch {
      // Non-parseable JSON lands in bodyRaw (§5), no parsing error ack.
      return { body: null, bodyRaw };
    }
  }
  if (ct.includes('application/x-www-form-urlencoded')) {
    const parsed: Record<string, string> = {};
    for (const [k, v] of new URLSearchParams(bodyRaw)) parsed[k] = v;
    return { body: parsed, bodyRaw };
  }
  // multipart/other: parsing unsupported (Q-WHT-03), raw best-effort capped.
  return { body: null, bodyRaw };
}

function methodAllowed(meta: Record<string, any>, method: string): boolean {
  const methods = Array.isArray(meta?.methods) ? meta.methods : null;
  if (!methods || methods.length === 0) return true; // default: all five
  return methods.map((m: any) => String(m).toUpperCase()).includes(method);
}

/** Empty-body 200 ack (V3). */
function ack(res: Response): void {
  res.status(200).end();
}

type HookMode = 'prod' | 'test';

async function handleCatchHook(req: Request, res: Response, mode: HookMode): Promise<void> {
  const zapId = req.params.zapId as string;
  const rawBody = (req as any).rawBody as Buffer | undefined;
  const contentType = req.headers['content-type'];

  try {
    const zap = await client.zap.findUnique({
      where: { id: zapId },
      include: { trigger: true },
    });

    if (!zap || !zap.trigger) {
      return void res.status(404).json({ error: 'Hook not found' });
    }

    const meta: Record<string, any> = (zap.trigger.metadata || {}) as Record<string, any>;

    // ---- URL lifecycle (Q-WHT-05) ----
    if (mode === 'test') {
      if (!meta.testHookId || meta.testHookId !== req.params.testId) {
        return void res.status(410).json({ error: 'Test hook URL not found or revoked' });
      }
    } else {
      const prodHookId = typeof meta.prodHookId === 'string' ? meta.prodHookId : '';
      if (prodHookId) {
        // Rotated hook: only the current hookId URL works; the legacy base
        // URL (and any previous hookId) is revoked immediately.
        if (!req.params.hookId || req.params.hookId !== prodHookId) {
          return void res
            .status(410)
            .json({ error: 'Webhook URL has been rotated or revoked — use the current URL' });
        }
      } else if (req.params.hookId) {
        return void res
          .status(410)
          .json({ error: 'No rotated webhook URL provisioned for this Zap' });
      }
    }

    // ---- Auth (V4) ----
    // One engine, one verdict: the hook's authMode selects the spec, and a
    // missing credential or unconfigured secret refuses with a coded status.
    const auth = verifyCatchHook(
      {
        headers: req.headers,
        // Raw bytes are authoritative (the hooks app captures them in
        // express.json's verify hook). The serializer fallback only serves
        // callers that never captured bytes.
        rawBody:
          rawBody && rawBody.length ? rawBody.toString('utf8') : JSON.stringify(req.body ?? {}),
        body: req.body ?? {},
      },
      { authMode: resolveAuthMode(meta), secret: resolveWebhookSecret(meta) }
    );
    if (!auth.ok) {
      return void res.status(auth.status).json({ message: auth.message, code: auth.code });
    }

    // ---- Method restriction (§3; default = all five) ----
    if (!methodAllowed(meta, req.method)) {
      return void res.status(405).json({ error: `Method ${req.method} not allowed for this hook` });
    }

    const { body, bodyRaw } = parseHookBody(rawBody, contentType);
    const receivedAt = new Date().toISOString();
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const pathParams: Record<string, string> = {
      userId: String(req.params.userId ?? ''),
      zapId: String(req.params.zapId ?? ''),
      ...(req.params.hookId ? { hookId: String(req.params.hookId) } : {}),
      ...(req.params.testId ? { testId: String(req.params.testId) } : {}),
    };

    if (mode === 'test') {
      // V2: store sample, never enqueue.
      const sample = {
        receivedAt,
        method: req.method,
        url,
        pathParams,
        query: req.query,
        headers: surfaceHeaders(req.headers),
        body,
        bodyRaw,
      };
      const samples = [sample, ...(Array.isArray(meta.hookSamples) ? meta.hookSamples : [])].slice(
        0,
        HOOK_SAMPLE_CAP
      );
      await client.trigger.update({
        where: { id: zap.trigger.id },
        data: { metadata: { ...meta, hookSamples: samples } },
      });
      console.log(`🧪 Test hook sample stored for zap ${zapId} (${req.method})`);
      return void ack(res);
    }

    // ---- §4 contract (+ legacy: body fields spread at top level) ----
    const legacySpread = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const contract = {
      ...legacySpread,
      method: req.method,
      url,
      pathParams,
      query: req.query,
      headers: surfaceHeaders(req.headers),
      body,
      bodyRaw,
      receivedAt,
    };

    // V6: x-request-id dedupe when present; legacy event_id fallback.
    const reqIdHeader = req.headers['x-request-id'];
    const reqId = Array.isArray(reqIdHeader) ? reqIdHeader[0] : reqIdHeader;
    const legacyEventId =
      typeof legacySpread?.event_id === 'string'
        ? legacySpread.event_id
        : typeof legacySpread?.eventId === 'string'
          ? legacySpread.eventId
          : undefined;
    const dedupeId = reqId || legacyEventId;

    const result = await enqueueRun({
      zapId,
      metadata: contract,
      source: 'hooks.webhook',
      dedup: {
        scope: 'webhook',
        key: dedupeId ? `${zapId}:${dedupeId}` : undefined,
      },
    });

    // V3: fixed 200 empty body — queued, duplicate and skipped all ack alike.
    if (result.status === 'duplicate') {
      console.log(`🔁 Duplicate delivery skipped for zap ${zapId} (${dedupeId})`);
    } else if (result.status === 'skipped') {
      console.log(`⚠️ Hook received but run skipped for zap ${zapId}: ${result.reason}`);
    } else {
      console.log(`📝 ZapRun queued: ${result.zapRunId} for zap ${zapId}`);
    }
    ack(res);
  } catch (error) {
    console.error('❌ Catch hook error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Hook processing failed' });
    }
  }
}

export function createCatchHookRouter(): Router {
  const router = Router();

  // Raw body capture for every /hooks/* request: size cap → 413 (no run),
  // body parsed later by content type. Marks req._body so the global
  // express.json() parser (mounted after this router) skips re-reading.
  router.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'OPTIONS') {
      return void ack(res); // CORS preflight answered (§5)
    }
    if (!ACCEPTED_METHODS.includes(req.method)) {
      return void res.status(405).json({ error: `Method ${req.method} not allowed` });
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let oversize = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_WEBHOOK_BYTES) {
        oversize = true;
        chunks.length = 0; // stop retaining
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (oversize) {
        return void res.status(413).json({ error: 'Payload too large' });
      }
      (req as any).rawBody = Buffer.concat(chunks);
      (req as any)._body = true; // body-parser skip flag
      next();
    });
    req.on('error', () => {
      if (!res.headersSent) res.status(400).json({ error: 'Request stream error' });
    });
  });

  // Test URL (V2): stores samples, never fires.
  router.all('/test/:userId/:zapId/:testId', (req, res) => handleCatchHook(req, res, 'test'));
  // Production URL (rotated form) and legacy base form.
  router.all('/:userId/:zapId/:hookId', (req, res) => handleCatchHook(req, res, 'prod'));
  router.all('/:userId/:zapId', (req, res) => handleCatchHook(req, res, 'prod'));

  return router;
}

export const catchHookRouter = createCatchHookRouter();
