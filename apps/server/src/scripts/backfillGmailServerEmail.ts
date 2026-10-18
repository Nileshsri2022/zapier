import client from '@repo/db';
import { GmailService } from '../services/GmailService';

/**
 * Backfill GmailServer.email (+ lastHistoryId) for servers connected
 * before those columns existed (reports/gmail-worker-routing-spec.md
 * D3/B3). Push dispatch resolves servers by mailbox address, so a
 * server with email=NULL can never be routed to — this fills it from
 * the Gmail profile using each server's own stored credentials.
 *
 * DRY-RUN by default (prints intended updates, writes nothing):
 *   bunx tsx src/scripts/backfillGmailServerEmail.ts
 *   bunx tsx src/scripts/backfillGmailServerEmail.ts --apply
 *
 * Requires the 20261019120000_gmail_server_email_history migration to
 * have been applied first (prisma migrate deploy). Idempotent: servers
 * that already have an email are skipped, and an existing history
 * cursor is never overwritten.
 */

export interface BackfillCandidate {
  id: string;
  email: string;
  /** Present only when the server row has no cursor yet. */
  lastHistoryId?: string;
}

export interface BackfillPlan {
  updates: BackfillCandidate[];
  /** Server ids whose profile could not be fetched (dead tokens etc.). */
  failures: string[];
}

/** Pure planning step (profile fetching injected) — unit-testable. */
export async function computeBackfillPlan(
  servers: Array<{ id: string; email?: string | null; lastHistoryId?: string | null }>,
  fetchProfile: (server: any) => Promise<{ email: string; historyId: string } | null>
): Promise<BackfillPlan> {
  const plan: BackfillPlan = { updates: [], failures: [] };

  for (const server of servers) {
    if (server.email) continue; // already backfilled / connected post-migration

    const profile = await fetchProfile(server).catch(() => null);
    if (!profile?.email) {
      plan.failures.push(server.id);
      continue;
    }

    plan.updates.push({
      id: server.id,
      email: profile.email,
      ...(server.lastHistoryId ? {} : { lastHistoryId: profile.historyId || undefined }),
    });
  }

  return plan;
}

async function main() {
  const apply = process.argv.includes('--apply');

  const servers = await client.gmailServer.findMany({
    where: { email: null },
  });

  console.log(
    `Found ${servers.length} GmailServer row(s) without an email.${apply ? '' : ' (dry-run)'}`
  );

  const plan = await computeBackfillPlan(servers as any, async (server) => {
    const gmailService = new GmailService({
      clientId: server.clientId,
      clientSecret: server.clientSecret,
      refreshToken: server.refreshToken,
      accessToken: server.accessToken,
      tokenExpiry: server.tokenExpiry || undefined,
    });
    return gmailService.getProfileEmail();
  });

  for (const update of plan.updates) {
    console.log(
      `  ${apply ? 'UPDATE' : 'WOULD UPDATE'} server ${update.id} -> ${update.email}` +
        (update.lastHistoryId ? ` (history cursor ${update.lastHistoryId})` : '')
    );
    if (apply) {
      await client.gmailServer.update({
        where: { id: update.id },
        data: {
          email: update.email,
          ...(update.lastHistoryId ? { lastHistoryId: update.lastHistoryId } : {}),
        },
      });
    }
  }

  for (const id of plan.failures) {
    console.warn(`  ⚠️ Server ${id}: profile fetch failed — left unresolved (dead token?)`);
  }

  console.log(
    `Done: ${plan.updates.length} update(s)${apply ? ' applied' : ' planned'}, ` +
      `${plan.failures.length} failure(s).${apply ? '' : ' Re-run with --apply to write.'}`
  );
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error('GmailServer email backfill failed:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await client.$disconnect();
    });
}
