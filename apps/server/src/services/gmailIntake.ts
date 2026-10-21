import client from '@repo/db';
import { enqueueRun } from '@repo/runs';
import { GmailService, EmailAttachment, EmailMetadata } from './GmailService';
import { matchesGmailQuery } from './gmailSearchQuery';

/**
 * Gmail trigger intake — the one place a Gmail delivery becomes ZapRuns.
 *
 * Historically this knowledge lived in `GmailDispatch` (a grab-bag of eight
 * exports), the webhook controller, and `GmailTriggersController`, which each
 * held a slice of the same pipeline. Now ingress decodes the wire envelope and
 * hands this module a `GmailDelivery`; everything after that — resolving the
 * mailbox's servers, reading the history delta or the relayed message,
 * hydrating it, matching triggers, deduping, and writing the
 * ZapRun + ZapRunOutbox pair the worker executes — happens here.
 *
 * Deliveries are a discriminated union, so an invalid combination (a Pub/Sub
 * notification with no cursor, a legacy event with no message) cannot be
 * constructed by typed callers instead of being rejected after the fact.
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

/** A real Gmail watch notification: the mailbox and the cursor it names. */
export interface PubsubGmailDelivery {
  source: 'pubsub';
  emailAddress: string;
  historyId: string;
}

/**
 * A legacy custom-relay delivery: an enriching relay used to name the changed
 * message itself. Real Gmail notifications contain only emailAddress +
 * historyId (spec audit B2); this branch survives until a usage probe shows
 * nothing depends on it (ADR-0005).
 */
export interface LegacyGmailDelivery {
  source: 'legacy';
  emailAddress: string;
  event: {
    eventType?: string;
    messageId?: string;
    threadId?: string;
    labelIds?: string[];
    starred?: boolean;
  };
}

export type GmailDelivery = PubsubGmailDelivery | LegacyGmailDelivery;

export interface GmailIntakeDeps {
  /** Hydration adapter. Tests pass a fake; production builds a live client. */
  createService?: (server: GmailServerLike) => GmailService;
}

export interface GmailIntakeResult {
  runsEnqueued: number;
}

interface GmailEventCounts {
  created: number;
  skipped: number;
  failed: number;
}

export interface GmailHistoryDeltaResult extends GmailEventCounts {
  /** True when there was no usable cursor and one was (re)initialized
   * without processing — first connect or a too-old cursor. */
  cursorReset: boolean;
}

export function createGmailService(server: GmailServerLike): GmailService {
  return new GmailService({
    clientId: server.clientId,
    clientSecret: server.clientSecret,
    refreshToken: server.refreshToken,
    accessToken: server.accessToken,
    tokenExpiry: server.tokenExpiry || undefined,
  });
}

/**
 * Resolve connected Gmail servers for a mailbox address (spec D3/B3).
 * Push notifications carry only the address; two users may connect the
 * same mailbox, so every active match fans out independently. Deliberately
 * unbounded — a single server is not an assumption this query may bake in.
 */
async function resolveGmailServersByEmail(email: string): Promise<GmailServerLike[]> {
  if (!email) return [];
  const servers = await client.gmailServer.findMany({
    where: { email, isActive: true },
  });
  return servers || [];
}

/**
 * Map the ingress event vocabulary (the legacy relay's synthetic event types)
 * onto the stored GmailTrigger.triggerType vocabulary. Unknown values fall
 * back to 'new_email' — shouldTrigger still decides per-Zap whether anything
 * fires.
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
 * (reports/gmail-worker-routing-spec.md §4.3 + docs/ask-matt/triggers/gmail.md §4).
 * This shape is what downstream templates ({subject}, {body}, …), filters, and
 * future AI steps bind to — treat breaking changes like any public API change.
 *
 * `bodyPlain`/`bodyHtml` (Q-GMAIL-03) and `attachments` (Q-GMAIL-04) are the
 * grilled additions; `body`/`bodyTruncated` remain for backward compatibility.
 *
 * Exported for the payload contract test only; no other module imports it.
 */
export function buildGmailRunPayload(
  metadata: EmailMetadata,
  content: {
    body: string;
    truncated: boolean;
    plain?: string;
    html?: string;
    attachments?: EmailAttachment[];
  },
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
    bodyPlain: content.plain ?? content.body,
    bodyHtml: content.html ?? null,
    attachments: content.attachments ?? [],
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
 * Hydrate one Gmail message and enqueue a ZapRun for every matching, active
 * GmailTrigger on the given server. Module-private: deliveries enter through
 * `intakeGmailDelivery`.
 *
 * Throws only when hydration itself fails (no rows are written in that
 * case, so a provider redelivery is safe). Per-Zap failures are caught,
 * logged, and counted — one bad Zap never blocks its siblings.
 */
async function dispatchGmailEvent(
  server: GmailServerLike,
  messageId: string,
  eventType: GmailEventType,
  rawEventType: string | undefined,
  deps: GmailIntakeDeps,
  existingService?: GmailService
): Promise<GmailEventCounts> {
  const gmailService = existingService || (deps.createService ?? createGmailService)(server);

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

  // Attachments (Q-GMAIL-04): metadata always; content inlined when ≤ 5 MB.
  // A failure here degrades to metadata-only inside getAttachments — it never
  // fails hydration.
  let attachments: EmailAttachment[] = [];
  if (metadata.hasAttachments) {
    attachments = (await gmailService.getAttachments?.(messageId)) ?? [];
  }

  const payload = buildGmailRunPayload(
    metadata,
    { ...content, attachments },
    eventType,
    server.id,
    rawEventType
  );

  const gmailTriggers = await client.gmailTrigger.findMany({
    where: { serverId: server.id },
    include: { zap: true },
  });

  const result: GmailEventCounts = { created: 0, skipped: 0, failed: 0 };

  for (const gmailTrigger of gmailTriggers) {
    const zap = (gmailTrigger as any).zap;

    if (!zap) {
      result.skipped++;
      continue;
    }

    if (!(await shouldTrigger(gmailTrigger, payload))) {
      result.skipped++;
      continue;
    }

    // The run-intake module owns the active-Zap check, the dedup claim and
    // the ZapRun + ZapRunOutbox transaction (spec D5). Dedup is keyed per
    // Zap + message + event kind, so a later star still fires.
    try {
      const intake = await enqueueRun({
        zapId: zap.id,
        metadata: payload,
        source: 'server.gmail',
        dedup: {
          scope: 'gmail',
          // zapId alone would suffice — a Zap has exactly one trigger, so the
          // trigger row and its server are implied. Message + event kind keep
          // a redelivery idempotent while letting a later star still fire.
          key: `${zap.id}:${messageId}:${eventType}`,
        },
      });

      if (intake.status === 'queued') {
        console.log(`📝 Gmail ZapRun queued: ${intake.zapRunId} for Zap ${zap.id} (${eventType})`);
        result.created++;
      } else {
        result.skipped++;
      }
    } catch (error) {
      result.failed++;
      console.error(`Failed to enqueue Gmail ZapRun for Zap ${zap.id}:`, error);
    }
  }

  return result;
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
  notificationHistoryId: string,
  deps: GmailIntakeDeps = {}
): Promise<GmailHistoryDeltaResult> {
  const empty: GmailHistoryDeltaResult = { created: 0, skipped: 0, failed: 0, cursorReset: false };
  const gmailService = (deps.createService ?? createGmailService)(server);

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

  const totals: GmailEventCounts = { created: 0, skipped: 0, failed: 0 };
  for (const event of mapHistoryRecords(records)) {
    const result = await dispatchGmailEvent(
      server,
      event.messageId,
      event.eventType,
      event.rawEventType,
      deps,
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
 * Turn one delivery into ZapRuns. Ingress calls this and nothing else.
 *
 * Every server matching the delivery's mailbox is handled independently, so
 * two users connected to the same mailbox each get their own runs. An
 * unknown mailbox is acknowledged rather than retried: no server exists now
 * and none will exist on redelivery, so a retry would only poison-loop.
 */
export async function intakeGmailDelivery(
  delivery: GmailDelivery,
  deps: GmailIntakeDeps = {}
): Promise<GmailIntakeResult> {
  // Runtime backstop for untyped callers; typed callers cannot express these.
  if (delivery.source !== 'pubsub' && delivery.source !== 'legacy') {
    throw new Error(`Gmail delivery has unknown source: ${String((delivery as any).source)}`);
  }

  const servers = await resolveGmailServersByEmail(delivery.emailAddress);
  if (servers.length === 0) {
    console.warn('gmail intake: no active server', {
      emailAddress: delivery.emailAddress,
      reason: 'no_active_server',
    });
    return { runsEnqueued: 0 };
  }

  let runsEnqueued = 0;

  if (delivery.source === 'pubsub') {
    for (const server of servers) {
      const delta = await processHistoryDelta(server, delivery.historyId, deps);
      runsEnqueued += delta.created;
    }
  } else {
    const { messageId, eventType } = delivery.event;
    if (!messageId) {
      console.warn('gmail intake: legacy delivery carries no message id', {
        emailAddress: delivery.emailAddress,
      });
      return { runsEnqueued: 0 };
    }

    for (const server of servers) {
      const dispatched = await dispatchGmailEvent(
        server,
        messageId,
        mapGmailEventType(eventType),
        eventType,
        deps
      );
      runsEnqueued += dispatched.created;
    }
  }

  console.log('gmail intake', { emailAddress: delivery.emailAddress, runsEnqueued });
  return { runsEnqueued };
}

// ---------------------------------------------------------------------------
// Trigger filtering. Semantics are unchanged from the controller-era code; the
// fix (spec audit B4) is that they now run against a hydrated payload that
// actually carries from/subject/labels.
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
      case 'matching_search':
        // Grilled E2 (Q-GMAIL-01): only *new* mail may fire a search match —
        // a later relabel/star of an old matching email must not re-fire it.
        if (emailData.eventType && emailData.eventType !== 'new_email') return false;
        return isMatchingSearchTrigger(emailData, metadata);
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

const isMatchingSearchTrigger = (emailData: any, metadata: any): boolean => {
  const query = metadata?.searchQuery;
  if (!query || !String(query).trim()) return false;
  return matchesGmailQuery(String(query), emailData);
};
