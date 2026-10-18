import redis from '@repo/redis';

/**
 * Webhook event deduplication (gap D3 in reports/workflow-execution-gaps.md).
 *
 * Webhook providers (Meta/WhatsApp, Telegram, Google, arbitrary clients)
 * deliver at-least-once: if they miss our ACK they redeliver the same event.
 * Without dedup, one external event can create multiple ZapRuns — duplicate
 * replies/emails, and for money-moving actions (Solana) duplicate transfers.
 *
 * Implementation: SET NX PX on Upstash Redis (24h TTL — far longer than any
 * provider's redelivery window, short enough not to mask a genuinely new
 * event with a reused id).
 *
 * Trade-off (documented): if Redis is unavailable we fail OPEN — the run
 * proceeds and a warning is logged. Availability is preferred over dedup;
 * the alternative (failing closed) would stall every Zap when Redis is down.
 */

const DEDUP_TTL_SECONDS = 24 * 60 * 60;

export function dedupKey(scope: string, eventId: string): string {
  return `zapmate:dedup:${scope}:${eventId}`;
}

/**
 * Returns true when this (scope, eventId) pair was already seen inside the
 * TTL window. An empty eventId is never a duplicate (callers without a
 * stable event id simply cannot dedup).
 */
export async function isDuplicateEvent(
  scope: string,
  eventId: string | null | undefined
): Promise<boolean> {
  if (!eventId) return false;

  try {
    const set = await redis.set(dedupKey(scope, eventId), '1', {
      px: DEDUP_TTL_SECONDS * 1000,
      nx: true,
    });
    // 'OK' -> first sighting; null -> key already existed => duplicate
    if (set === null) {
      console.log(`🔁 Duplicate event skipped (${scope}): ${eventId}`);
      return true;
    }
    return false;
  } catch (error) {
    console.warn(
      '⚠️ Dedup check failed, failing open:',
      error instanceof Error ? error.message : error
    );
    return false;
  }
}
