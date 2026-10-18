import redis from '@repo/redis';

/**
 * Event deduplication for server-side trigger ingress.
 *
 * Deliberately mirrors `apps/hooks/src/dedup.ts` (gap D3/F1 in
 * reports/workflow-execution-gaps.md): providers deliver at-least-once, so
 * one external event must create exactly one ZapRun — for money-moving
 * actions a duplicate run can mean a duplicate transfer.
 *
 * Implementation: SET NX PX on Upstash Redis (24h TTL). Trade-off is the
 * same documented one as hooks: if Redis is unavailable we fail OPEN — the
 * run proceeds and a warning is logged.
 *
 * Why a server-local copy instead of importing the hooks helper: hooks is a
 * separately deployed app and the server cannot import across app
 * boundaries. Unifying both into @repo/redis is a tracked follow-up in
 * reports/gmail-worker-routing-spec.md §10.
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
