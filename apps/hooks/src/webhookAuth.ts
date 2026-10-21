import crypto from 'crypto';

/**
 * Generic webhook authentication for `POST /hooks/:userId/:zapId`
 * (item F5 in reports/workflow-execution-gaps.md).
 *
 * Security model (consistent with apps/server TriggerController, §6.1 of
 * reports/karpathy-guidelines-audit.md):
 * - When a secret is configured (either per-Zap in `trigger.metadata.secret` /
 *   `trigger.metadata.webhookSecret` or service-wide via `WEBHOOK_SECRET`),
 *   authentication is MANDATORY and fails closed with 401 when missing or wrong.
 * - Callers may authenticate with either:
 *   1. `x-webhook-signature: sha256=<hex>` (HMAC-SHA256 of JSON payload), or
 *   2. `x-webhook-secret: <secret>` (or `Authorization: Bearer <secret>`).
 * - When no secret is configured at either level, capability-URL callers
 *   continue to work. No hardcoded fallback key is ever used.
 */

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function getHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  const direct = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(direct)) {
    return direct[0];
  }
  return typeof direct === 'string' && direct.trim().length > 0 ? direct.trim() : undefined;
}

/**
 * Resolve the effective webhook secret for a Zap: per-trigger metadata secret
 * takes precedence over the service-wide `WEBHOOK_SECRET` environment variable.
 */
export function resolveWebhookSecret(triggerMetadata?: unknown): string | undefined {
  if (triggerMetadata && typeof triggerMetadata === 'object') {
    const meta = triggerMetadata as Record<string, unknown>;
    const perZap =
      typeof meta.secret === 'string' && meta.secret.trim().length > 0
        ? meta.secret.trim()
        : typeof meta.webhookSecret === 'string' && meta.webhookSecret.trim().length > 0
          ? meta.webhookSecret.trim()
          : undefined;
    if (perZap) {
      return perZap;
    }
  }

  const envSecret = process.env.WEBHOOK_SECRET?.trim();
  return envSecret && envSecret.length > 0 ? envSecret : undefined;
}

/**
 * Verify an HMAC-SHA256 `sha256=<hex>` signature over `payload`.
 * Returns false when no secret is configured (never uses a fallback key).
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret = process.env.WEBHOOK_SECRET
): boolean {
  const resolved = secret?.trim();
  if (!resolved || !signature) {
    return false;
  }

  const digest = crypto.createHmac('sha256', resolved).update(payload).digest('hex');
  return constantTimeEquals(signature.trim(), `sha256=${digest}`);
}

export interface WebhookAuthResult {
  authorized: boolean;
  status?: number;
  message?: string;
}

/**
 * Authenticate an incoming generic webhook request.
 *
 * Per-hook auth mode (T5 spec Q-WHT-02) is read from trigger.metadata.authMode:
 * - 'none'   → open hook (unguessable URL is the only gate)
 * - 'static' → static key via x-webhook-secret / Authorization: Bearer; a
 *              missing or wrong key → 401, no run
 * - 'hmac'   → x-webhook-signature: sha256=<hex> over the raw body; missing
 *              or invalid → 403, no run (spec §5)
 * - absent   → legacy implicit behavior: secret configured (per-zap or env)
 *              ⇒ mandatory (fail closed, 401), otherwise capability URL.
 */
export function verifyWebhookRequest(
  headers: Record<string, string | string[] | undefined>,
  body: unknown,
  triggerMetadata?: unknown
): WebhookAuthResult {
  const secret = resolveWebhookSecret(triggerMetadata);

  const meta = triggerMetadata && typeof triggerMetadata === 'object'
    ? (triggerMetadata as Record<string, unknown>)
    : undefined;
  const authMode =
    typeof meta?.authMode === 'string' ? meta.authMode.trim().toLowerCase() : undefined;

  if (authMode === 'none') {
    return { authorized: true };
  }

  const signature = getHeader(headers, 'x-webhook-signature');
  const sharedSecretHeader = getHeader(headers, 'x-webhook-secret');
  const authHeader = getHeader(headers, 'authorization');
  const bearerSecret =
    authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;

  if (authMode === 'static') {
    if (!secret) {
      return {
        authorized: false,
        status: 401,
        message: 'Static key auth mode selected but no secret is configured',
      };
    }
    const candidateSecret = sharedSecretHeader ?? bearerSecret;
    if (!candidateSecret) {
      return { authorized: false, status: 401, message: 'Static key required' };
    }
    if (constantTimeEquals(candidateSecret, secret)) {
      return { authorized: true };
    }
    return { authorized: false, status: 401, message: 'Invalid static key' };
  }

  if (authMode === 'hmac') {
    if (!secret) {
      return {
        authorized: false,
        status: 401,
        message: 'HMAC auth mode selected but no secret is configured',
      };
    }
    if (!signature) {
      return { authorized: false, status: 403, message: 'Webhook signature required' };
    }
    const serialized = typeof body === 'string' ? body : JSON.stringify(body ?? {});
    if (verifyWebhookSignature(serialized, signature, secret)) {
      return { authorized: true };
    }
    return { authorized: false, status: 403, message: 'Invalid webhook signature' };
  }

  // ---- Legacy implicit mode (no authMode configured) ----
  // Capability-URL mode when no secret is configured at trigger or env level
  if (!secret) {
    return { authorized: true };
  }

  if (signature) {
    const serialized = typeof body === 'string' ? body : JSON.stringify(body ?? {});
    if (verifyWebhookSignature(serialized, signature, secret)) {
      return { authorized: true };
    }
    return { authorized: false, status: 401, message: 'Invalid webhook signature' };
  }

  const candidateSecret = sharedSecretHeader ?? bearerSecret;

  if (candidateSecret) {
    if (constantTimeEquals(candidateSecret, secret)) {
      return { authorized: true };
    }
    return { authorized: false, status: 401, message: 'Invalid webhook signature' };
  }

  return { authorized: false, status: 401, message: 'Webhook signature required' };
}
