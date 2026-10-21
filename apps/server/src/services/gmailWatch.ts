import client from '@repo/db';
import {
  GmailServerLike,
  createGmailService,
  processHistoryDelta,
  type GmailIntakeDeps,
} from './gmailIntake';

/**
 * Gmail watch lifecycle — the two clock-driven sweeps, separate from intake
 * because they answer a different question: intake routes one delivery, this
 * module keeps the channel itself alive and catches up what push missed.
 *
 * Both are invoked only by `routes/CronRoutes.ts` under the shared cron secret.
 */

/**
 * Anything expiring inside this window is renewed on the next sweep. Gmail
 * watches die after 7 days, so a daily cron always renews with days to spare —
 * shrinking this below the cron interval would let a watch lapse between runs.
 */
export const GMAIL_WATCH_RENEWAL_WINDOW_HOURS = 24;
export const GMAIL_WATCH_RENEWAL_WINDOW_MS = GMAIL_WATCH_RENEWAL_WINDOW_HOURS * 60 * 60 * 1000;

export interface GmailWatchDeps {
  createService?: GmailIntakeDeps['createService'];
  /** Clock seam: tests pin the renewal horizon instead of faking timers. */
  now?: () => Date;
}

/**
 * Renew Gmail watches expiring within the renewal window (spec §4.4). Gmail
 * watches die after 7 days; without renewal push silently stops.
 * Renewal does NOT touch lastHistoryId (history.list from the existing
 * cursor stays valid across renewals; resetting it would skip the
 * unprocessed delta) — it only initializes the cursor when unset.
 *
 * Each renewal writes its own GmailWatch row as it succeeds: one mailbox
 * failing must not roll back the renewals that already committed.
 */
export async function renewExpiringGmailWatches(
  deps: GmailWatchDeps = {}
): Promise<{ renewed: number; failed: number; checked: number }> {
  const now = deps.now?.() ?? new Date();
  const createService = deps.createService ?? createGmailService;
  const horizon = new Date(now.getTime() + GMAIL_WATCH_RENEWAL_WINDOW_MS);
  const servers = (await client.gmailServer.findMany({
    where: { isActive: true },
    include: { watchHistory: { orderBy: { createdAt: 'desc' }, take: 1 } },
  })) as any[];

  let renewed = 0;
  let failed = 0;

  for (const server of servers) {
    const latestWatch = server.watchHistory?.[0];
    const needsRenewal =
      !latestWatch || !latestWatch.isActive || new Date(latestWatch.expiry) <= horizon;
    if (!needsRenewal) continue;

    try {
      const gmailService = createService(server);
      const watchResult = await gmailService.watchEmails(['INBOX']);

      await client.gmailWatch.create({
        data: {
          serverId: server.id,
          watchId: watchResult.watchId,
          expiry: watchResult.expiry,
          isActive: true,
        },
      });

      if (!server.lastHistoryId && watchResult.watchId) {
        await client.gmailServer.update({
          where: { id: server.id },
          data: { lastHistoryId: watchResult.watchId },
        });
      }

      console.log(`📬 Gmail watch renewed for server ${server.id} (expiry ${watchResult.expiry})`);
      renewed++;
    } catch (error) {
      failed++;
      console.error(`Failed to renew Gmail watch for server ${server.id}:`, error);
    }
  }

  return { renewed, failed, checked: servers.length };
}

/**
 * Polling fallback (grilled Q-GMAIL-02: push primary + polling fallback).
 * For every active server with a cursor, list the profile's current
 * historyId and process the delta if it advanced — the same safe path push
 * uses, so missed notifications (GCP outage, expired watch, lost push)
 * are caught up without duplicate fires (dedup claims inside intake absorb
 * overlap with push deliveries).
 *
 * Invoked by GET /api/cron/poll-gmail on the shared cron secret.
 */
export async function pollActiveGmailServers(deps: GmailWatchDeps = {}): Promise<{
  created: number;
  skipped: number;
  failed: number;
  polled: number;
  failedServers: number;
  cursorReset: number;
}> {
  const createService = deps.createService ?? createGmailService;
  const totals = { created: 0, skipped: 0, failed: 0, polled: 0, failedServers: 0, cursorReset: 0 };

  const servers = (await client.gmailServer.findMany({
    where: { isActive: true },
  })) as GmailServerLike[];

  for (const server of servers) {
    try {
      const gmailService = createService(server);
      const profile = await gmailService.getProfileEmail();
      const currentHistoryId = profile?.historyId;
      if (!currentHistoryId) continue;

      if (server.lastHistoryId && currentHistoryId !== server.lastHistoryId) {
        const result = await processHistoryDelta(server, currentHistoryId, {
          createService: deps.createService,
        });
        totals.created += result.created;
        totals.skipped += result.skipped;
        totals.failed += result.failed;
        if (result.cursorReset) totals.cursorReset++;
        totals.polled++;
      }
    } catch (error) {
      totals.failedServers++;
      console.error(`Gmail poll fallback failed for server ${server.id}:`, error);
    }
  }

  return totals;
}
