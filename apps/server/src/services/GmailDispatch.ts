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
  rawEventType?: string
): Promise<GmailDispatchResult> {
  const gmailService = new GmailService({
    clientId: server.clientId,
    clientSecret: server.clientSecret,
    refreshToken: server.refreshToken,
    accessToken: server.accessToken,
    tokenExpiry: server.tokenExpiry || undefined,
  });

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
