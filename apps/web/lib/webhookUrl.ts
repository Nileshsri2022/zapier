/**
 * Which Zaps are offered a hook ingress URL, and what that URL is.
 *
 * Only the `Webhook` trigger is reachable through the catch-hook ingress
 * (`POST /hooks/:userId/:zapId`). Every other trigger — schedule, Gmail, Sheets,
 * Calendar, GitHub, WhatsApp, Telegram — is driven by its own poller or webhook
 * route, so printing a copyable hook URL for it was misleading: users pasted it
 * into a third party and could not understand why the Zap fired with junk
 * trigger data, and the URL is an unauthenticated ingress for a Zap that was
 * never meant to be webhook-driven.
 *
 * This lives outside the page because the dashboard renders the same block twice
 * (desktop table + mobile cards); the decision belongs in one place.
 */

export const WEBHOOK_TRIGGER_TYPE = 'Webhook';

export interface WebhookUrlInput {
  /** Zap id. */
  id: string;
  /** Owner id, used as the capability path segment. */
  userId?: number | string | null;
  /** `trigger.trigger.type` from the Zap payload. */
  triggerType?: string | null;
  /** Rotated production hook id, carried in trigger metadata when present. */
  prodHookId?: string | null;
}

export function webhookUrlFor(zap: WebhookUrlInput, hooksUrl: string): string | null {
  if (zap.triggerType !== WEBHOOK_TRIGGER_TYPE) return null;
  if (zap.userId === null || zap.userId === undefined || zap.userId === '') return null;
  if (!zap.id) return null;

  const base = `${hooksUrl}/hooks/${zap.userId}/${zap.id}`;
  return zap.prodHookId ? `${base}/${zap.prodHookId}` : base;
}

export default webhookUrlFor;
