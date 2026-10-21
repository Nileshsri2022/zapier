/**
 * Where a catch-hook secret comes from: per-trigger metadata first, then the
 * service-wide env var. Resolution lives beside the specs because it is part of
 * the ingress policy — not something a call site should re-invent.
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
    if (perZap) return perZap;
  }

  const envSecret = process.env.WEBHOOK_SECRET?.trim();
  return envSecret && envSecret.length > 0 ? envSecret : undefined;
}

/** Read an authMode off trigger metadata without trusting its shape. */
export function resolveAuthMode(triggerMetadata?: unknown): string | undefined {
  if (!triggerMetadata || typeof triggerMetadata !== 'object') return undefined;
  const mode = (triggerMetadata as Record<string, unknown>).authMode;
  return typeof mode === 'string' && mode.trim() ? mode.trim().toLowerCase() : undefined;
}
