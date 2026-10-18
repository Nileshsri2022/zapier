import client from '@repo/db';
import { GmailService, EmailMetadata } from './GmailService';
import { isDuplicateEvent } from '../utils/dedup';

/**
 * Gmail trigger dispatch — the routing core of
 * reports/gmail-worker-routing-spec.md (phase P2).
 *
 * Historically, Gmail events were executed inline in this API server
 * (ZapController.executeZapActions). This module instead turns a Gmail
 * event into the same ZapRun + ZapRunOutbox pair every other trigger
 * produces, so apps/worker executes the Zap with chaining, retries, and
 * step conditions.
 *
 * The dispatch is ingress-agnostic: callers supply a resolved GmailServer
 * row, a message id, and an event type. Whether that event arrived via
 * Pub/Sub push or (future) polling is decided at the spec's D2 gate (P3).
 *
 * Rollout: GmailTriggersController only calls this when
 * GMAIL_EXECUTION_PATH=outbox (default: legacy inline path, unchanged).
 * The switch and the legacy executor are deleted in P5 of the spec.
 */

export type GmailEventType = 'new_email' | 'labeled' | 'starred' | 'moved';

export interface GmailServerLike {
  id: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accessToken: string;
  tokenExpiry?: Date | null;
  email?: string | null;
  lastHistoryId?: string | null;
}

function createGmailService(server: GmailServerLike): GmailService {
  return new GmailService({
    clientId: server.clientId,
    clientSecret: server.clientSecret,
    refreshToken: server.refreshToken,
    accessToken: server.accessToken,
    tokenExpiry: server.tokenExpiry || undefined,
  });
}

export interface GmailDispatchResult {
  created: number;
  skipped: number;
  failed: number;
}

/** Which execution path Gmail dispatch uses (spec D6 kill-switch). */
export function gmailExecutionPath(): 'inline' | 'outbox' {
  return process.env.GMAIL_EXECUTION_PATH === 'outbox' ? 'outbox' : 'inline';
}

/**
 * Map the ingress event vocabulary (GmailWebhookController's synthetic
 * event types) onto the stored GmailTrigger.triggerType vocabulary.
 * Unknown values fall back to 'new_email' — shouldTrigger still decides
 * per-Zap whether anything fires.
 */
export function mapGmailEventType(rawEventType: string | undefined): GmailEventType {
  switch (rawEventType) {
    case 'starred':
    case 'unstarred':
      // Hydrated labels decide: an "unstarred" event simply won't carry
      // STARRED when hydrated, so starred triggers won't match.
      return 'starred';
    case 'labeled':
    case 'label_added':
    case 'label_removed':
      return 'labeled';
    case 'moved':
      return 'moved';
    case 'new_email':
    default:
      return 'new_email';
  }
}

function toIsoString(value: unknown): string {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  }
  return value == null ? '' : String(value);
}

/**
 * The ZapRun.metadata payload contract for Gmail triggers
 * (reports/gmail-worker-routing-spec.md §4.3). This shape is what
 * downstream templates ({subject}, {body}, …), filters, and future AI
 * steps bind to — treat breaking changes like any public API change.
 */
export function buildGmailRunPayload(
  metadata: EmailMetadata,
  content: { body: string; truncated: boolean },
  eventType: GmailEventType,
  serverId: string,
  rawEventType?: string
): Record<string, any> {
  return {
    id: metadata.id,
    messageId: metadata.id,
    threadId: metadata.threadId,
    eventType,
    ...(rawEventType && rawEventType !== eventType ? { rawEventType } : {}),
    from: metadata.from,
    to: metadata.to,
    subject: metadata.subject,
    snippet: metadata.snippet,
    body: content.body,
    bodyTruncated: content.truncated,
    labels: metadata.labels,
    labelIds: metadata.labels,
    date: toIsoString(metadata.date),
    timestamp: new Date().toISOString(),
    hasAttachments: metadata.hasAttachments,
    isRead: metadata.isRead,
    serverId,
  };
}

/**
 * Hydrate one Gmail message and enqueue a ZapRun for every matching,
 * active GmailTrigger on the given server.
 *
 * Throws only when hydration itself fails (no rows are written in that
 * case, so a provider redelivery is safe). Per-Zap failures are caught,
 * logged, and counted — one bad Zap never blocks its siblings.
 */
export async function dispatchGmailEvent(
  server: GmailServerLike,
  messageId: string,
  eventType: GmailEventType,
  rawEventType?: string,
  existingService?: GmailService
): Promise<GmailDispatchResult> {
  const gmailService = existingService || createGmailService(server);

  // Hydrate once per message (not per Zap). Filters and downstream steps
  // need from/subject/labels/body — the bare notification ids the ingress
  // historically forwarded were not enough (spec audit finding B4).
  const metadata = await gmailService.getEmailMetadata(messageId);
  if (!metadata) {
    throw new Error(`Failed to hydrate Gmail message ${messageId} (metadata unavailable)`);
  }
  const content = await gmailService.getEmailContent(messageId);
  if (!content) {
    throw new Error(`Failed to hydrate Gmail message ${messageId} (body unavailable)`);
  }

  const payload = buildGmailRunPayload(metadata, content, eventType, server.id, rawEventType);

  const gmailTriggers = await client.gmailTrigger.findMany({
    where: { serverId: server.id },
    include: { zap: true },
  });

  const result: GmailDispatchResult = { created: 0, skipped: 0, failed: 0 };

  for (const gmailTrigger of gmailTriggers) {
    const zap = (gmailTrigger as any).zap;

    // Only active Zaps get runs. The processor's outbox drain also filters
    // on isActive, but relying on it would strand rows in the outbox for
    // Zaps that are off (same semantics as the legacy inline path).
    if (!zap || !zap.isActive) {
      result.skipped++;
      continue;
    }

    if (!(await shouldTrigger(gmailTrigger, payload))) {
      result.skipped++;
      continue;
    }

    // Claim the dedup slot BEFORE writing rows: if a later Zap fails and
    // the provider redelivers, already-processed Zaps are skipped instead
    // of double-fired (spec D5).
    if (await isDuplicateEvent('gmail', `${zap.id}:${messageId}:${eventType}`)) {
      result.skipped++;
      continue;
    }

    try {
      const zapRun = await client.$transaction(async (tx: any) => {
        const run = await tx.zapRun.create({
          data: { zapId: zap.id, metadata: payload },
        });
        await tx.zapRunOutbox.create({ data: { zapRunId: run.id } });
        return run;
      });
      console.log(`📝 Gmail ZapRun created: ${zapRun.id} for Zap ${zap.id} (${eventType})`);
      result.created++;
    } catch (error) {
      result.failed++;
      console.error(`Failed to enqueue Gmail ZapRun for Zap ${zap.id}:`, error);
    }
  }

  return result;
}

/**
 * Resolve connected Gmail servers for a mailbox address (spec D3/B3).
 * Push notifications carry only the address; two users may connect the
 * same mailbox, so every active match fans out independently.
 */
export async function resolveGmailServersByEmail(email: string): Promise<GmailServerLike[]> {
  if (!email) return [];
  const servers = await client.gmailServer.findMany({
    where: { email, isActive: true },
  });
  return servers || [];
}

export interface GmailHistoryEvent {
  messageId: string;
  eventType: GmailEventType;
  rawEventType: string;
}

/**
 * Map Gmail `users.history.list` records onto the stored
 * GmailTrigger.triggerType vocabulary (pure — unit-testable).
 * Mapping is deliberately conservative; `shouldTrigger` still applies
 * each Zap's own label/sender/subject filters on the hydrated payload:
 * - messagesAdded                          -> new_email
 * - labelsAdded containing STARRED         -> starred
 * - labelsAdded (any other label)          -> labeled
 * - labelsRemoved containing INBOX         -> moved (left the inbox)
 * - labelsRemoved (any other label)        -> labeled
 * Duplicates within the batch collapse to one event per message+type.
 */
export function mapHistoryRecords(records: any[]): GmailHistoryEvent[] {
  const seen = new Set<string>();
  const events: GmailHistoryEvent[] = [];

  const add = (messageId: unknown, eventType: GmailEventType, rawEventType: string) => {
    if (typeof messageId !== 'string' || !messageId) return;
    const key = `${messageId}:${eventType}`;
    if (seen.has(key)) return;
    seen.add(key);
    events.push({ messageId, eventType, rawEventType });
  };

  for (const record of records || []) {
    for (const entry of record?.messagesAdded || []) {
      add(entry?.message?.id, 'new_email', 'messageAdded');
    }
    for (const entry of record?.labelsAdded || []) {
      const labels: string[] = entry?.labelIds || [];
      add(entry?.message?.id, labels.includes('STARRED') ? 'starred' : 'labeled', 'labelAdded');
    }
    for (const entry of record?.labelsRemoved || []) {
      const labels: string[] = entry?.labelIds || [];
      add(entry?.message?.id, labels.includes('INBOX') ? 'moved' : 'labeled', 'labelRemoved');
    }
  }

  return events;
}

export interface GmailHistoryDeltaResult extends GmailDispatchResult {
  /** True when there was no usable cursor and one was (re)initialized
   * without processing — first connect or a too-old cursor. */
  cursorReset: boolean;
}

/**
 * Process one real Gmail watch notification for a server: list the
 * history delta since the stored cursor, dispatch each changed message,
 * then advance the cursor. The cursor advances only after the whole
 * batch is enqueued — if hydration throws mid-batch, the error
 * propagates (push provider redelivers) and the dedup claims in
 * dispatchGmailEvent make the retry skip already-enqueued Zaps.
 */
export async function processHistoryDelta(
  server: GmailServerLike,
  notificationHistoryId: string
): Promise<GmailHistoryDeltaResult> {
  const empty: GmailHistoryDeltaResult = { created: 0, skipped: 0, failed: 0, cursorReset: false };
  const gmailService = createGmailService(server);

  // First notification ever for this server: start from "now". Listing
  // from the dawn of the mailbox would fire Zaps for ancient mail.
  if (!server.lastHistoryId) {
    await client.gmailServer.update({
      where: { id: server.id },
      data: { lastHistoryId: notificationHistoryId },
    });
    console.log(
      `📬 Gmail history cursor initialized for server ${server.id} at ${notificationHistoryId}`
    );
    return { ...empty, cursorReset: true };
  }

  const records = await gmailService.listHistory(server.lastHistoryId);

  // Cursor too old to list (Gmail expires old history ids): reset to the
  // notification's id and move on — events in the gap are unrecoverable
  // by design, and retrying would poison-loop the endpoint.
  if (records === null) {
    await client.gmailServer.update({
      where: { id: server.id },
      data: { lastHistoryId: notificationHistoryId },
    });
    console.warn(
      `📬 Gmail history cursor reset for server ${server.id} (was ${server.lastHistoryId})`
    );
    return { ...empty, cursorReset: true };
  }

  const totals: GmailDispatchResult = { created: 0, skipped: 0, failed: 0 };
  for (const event of mapHistoryRecords(records)) {
    const result = await dispatchGmailEvent(
      server,
      event.messageId,
      event.eventType,
      event.rawEventType,
      gmailService
    );
    totals.created += result.created;
    totals.skipped += result.skipped;
    totals.failed += result.failed;
  }

  await client.gmailServer.update({
    where: { id: server.id },
    data: { lastHistoryId: notificationHistoryId },
  });

  return { ...totals, cursorReset: false };
}

/**
 * Renew Gmail watches expiring within 24 hours (spec §4.4). Gmail
 * watches die after 7 days; without renewal push silently stops.
 * Renewal does NOT touch lastHistoryId (history.list from the existing
 * cursor stays valid across renewals; resetting it would skip the
 * unprocessed delta) — it only initializes the cursor when unset.
 */
export async function renewExpiringGmailWatches(
  now: Date = new Date()
): Promise<{ renewed: number; failed: number; checked: number }> {
  const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
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
      const gmailService = createGmailService(server);
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

// ---------------------------------------------------------------------------
// Trigger filtering. Moved verbatim from GmailTriggersController — semantics
// are unchanged; the fix (spec audit B4) is that these now run against a
// hydrated payload that actually carries from/subject/labels.
// ---------------------------------------------------------------------------

export const shouldTrigger = async (gmailTrigger: any, emailData: any): Promise<boolean> => {
  try {
    const { triggerType, watchedLabels, senderFilter, subjectFilter, metadata } = gmailTrigger;

    // Check trigger type
    switch (triggerType) {
      case 'new_email':
        return isNewEmailTrigger(emailData, {
          watchedLabels,
          senderFilter,
          subjectFilter,
          metadata,
        });
      case 'labeled':
        return isLabeledTrigger(emailData, metadata);
      case 'starred':
        return isStarredTrigger(emailData, metadata);
      case 'moved':
        return isMovedTrigger(emailData, metadata);
      default:
        return false;
    }
  } catch (error) {
    console.error('Error checking trigger condition:', error);
    return false;
  }
};

const isNewEmailTrigger = (emailData: any, filters: any): boolean => {
  // Check if email matches the filters
  if (filters.watchedLabels && filters.watchedLabels.length > 0) {
    const hasWatchedLabel = emailData.labels?.some((label: string) =>
      filters.watchedLabels.includes(label)
    );
    if (!hasWatchedLabel) return false;
  }

  if (filters.senderFilter) {
    const senderMatch = emailData.from?.toLowerCase().includes(filters.senderFilter.toLowerCase());
    if (!senderMatch) return false;
  }

  if (filters.subjectFilter) {
    const subjectMatch = emailData.subject
      ?.toLowerCase()
      .includes(filters.subjectFilter.toLowerCase());
    if (!subjectMatch) return false;
  }

  return true;
};

const isLabeledTrigger = (emailData: any, metadata: any): boolean => {
  // Check if email was recently labeled
  const targetLabels = metadata?.targetLabels || [];
  return emailData.labels?.some((label: string) => targetLabels.includes(label));
};

const isStarredTrigger = (emailData: any, metadata: any): boolean => {
  // Check if email was starred
  return emailData.labels?.includes('STARRED');
};

const isMovedTrigger = (emailData: any, metadata: any): boolean => {
  // Check if email was moved to specific folder
  const targetFolder = metadata?.targetFolder;
  return emailData.labels?.includes(targetFolder);
};
