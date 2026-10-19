import { Redis } from '@upstash/redis';
import dotenv from 'dotenv';

dotenv.config();

// Get Redis configuration from environment variables
const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

// Validate environment variables
if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) {
  console.warn('⚠️ Upstash Redis credentials not configured. Some features may not work.');
}

// Create Redis client
const redis = new Redis({
  url: UPSTASH_REDIS_REST_URL || '',
  token: UPSTASH_REDIS_REST_TOKEN || '',
});

// Log connection status
if (UPSTASH_REDIS_REST_URL) {
  console.log(`🔗 Upstash Redis configured: ${UPSTASH_REDIS_REST_URL.substring(0, 30)}...`);
}

const DEDUP_TTL_SECONDS = 24 * 60 * 60;

/**
 * Shared event-dedup helpers (gap D3/F1 in reports/workflow-execution-gaps.md).
 *
 * Providers deliver at-least-once: if they miss our ACK they redeliver the
 * same event. Without dedup, one external event can create multiple ZapRuns —
 * duplicate replies/emails, and for money-moving actions (Solana) duplicate
 * transfers.
 *
 * Implementation: SET NX PX on Upstash Redis (24h TTL — far longer than any
 * provider's redelivery window, short enough not to mask a genuinely new
 * event with a reused id).
 *
 * Trade-off (documented): if Redis is unavailable we fail OPEN — the run
 * proceeds and a warning is logged. Availability is preferred over dedup;
 * the alternative (failing closed) would stall every Zap when Redis is down.
 *
 * This is the single copy. It used to exist in both apps/hooks and
 * apps/server; reports/gmail-worker-routing-spec.md §10 tracked the
 * unification.
 */
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

/**
 * Release a dedup slot after the durable write it guards failed. Without
 * this, a provider redelivery would be skipped for 24h even though no run
 * exists. Best effort: releasing after a concurrent duplicate was already
 * skipped can only allow a later redelivery to retry, never a double run.
 */
export async function releaseEvent(
  scope: string,
  eventId: string | null | undefined
): Promise<void> {
  if (!eventId) return;
  try {
    await redis.del(dedupKey(scope, eventId));
  } catch (error) {
    console.warn(
      '⚠️ Dedup release failed:',
      error instanceof Error ? error.message : error
    );
  }
}

export { redis, Redis };
export default redis;
