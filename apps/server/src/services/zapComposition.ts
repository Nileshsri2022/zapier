import client from '@repo/db';
import { AiMetadataError, validateActionMetadata } from './ai';
import { computeNextRun, normalizeCron, validateCron, type ScheduleType } from './schedule';

/**
 * Zap composition — the one place that knows what a Zap is made of.
 *
 * A Zap is a trigger plus an ordered list of steps, and several triggers need a
 * provider-specific *shadow row* (GmailTrigger, ScheduledTrigger, …) that the
 * ingress reads. That knowledge used to live inline in `createZap`, and its
 * teardown list lived separately in `deleteZapWithId`; the two lists drifted
 * (one called `tx.whatsAppTrigger.create`, the other
 * `(tx as any).whatsAppTrigger?.deleteMany?.`). Here an adapter answers both
 * questions, so a new trigger kind cannot be half-implemented.
 *
 * Interface: `composeZap(draft, { userId })` and `removeZap(zapId, { userId })`.
 * Both own their transaction; validation happens before any write.
 */

export type ZapCompositionErrorCode =
  | 'UNKNOWN_TRIGGER'
  | 'TRIGGER_KIND_UNKNOWN'
  | 'INVALID_CRON'
  | 'INVALID_ACTION_METADATA'
  | 'INVALID_TRIGGER_METADATA'
  | 'MISSING_CONNECTION'
  | 'CONNECTION_NOT_OWNED';

export class ZapCompositionError extends Error {
  constructor(
    public readonly code: ZapCompositionErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ZapCompositionError';
  }
}

export type TriggerKind =
  | 'gmail'
  | 'sheets'
  | 'calendar'
  | 'schedule'
  | 'whatsapp'
  | 'telegram'
  | 'webhook'
  | 'github';

/**
 * Explicit type → kind table. Deliberately *not* prefix matching: `startsWith`
 * turns the day someone adds "Gmail Calendar Sync" into a silent
 * misclassification, while an unknown key fails loudly below.
 */
const KIND_BY_TYPE: Record<string, TriggerKind> = {
  Webhook: 'webhook',

  'Gmail New Email': 'gmail',
  'Gmail Labeled': 'gmail',
  'Gmail Starred': 'gmail',
  'Gmail From Sender': 'gmail',
  'Gmail Matching Search': 'gmail',

  'GitHub Push': 'github',
  'GitHub Pull Request': 'github',
  'GitHub Issue': 'github',
  'GitHub Release': 'github',

  'Google Sheets New Row': 'sheets',
  'Google Sheets Updated Row': 'sheets',

  'Google Calendar New Event': 'calendar',
  'Google Calendar Event Updated': 'calendar',
  'Google Calendar Event Start': 'calendar',
  'Google Calendar Event Ended': 'calendar',
  'Google Calendar Event Cancelled': 'calendar',
  'Google Calendar New Calendar': 'calendar',
  'Google Calendar Event Matching Search': 'calendar',

  'Schedule Every Minute': 'schedule',
  'Schedule Every Hour': 'schedule',
  'Schedule Every Day': 'schedule',
  'Schedule Every Week': 'schedule',
  'Schedule Every Month': 'schedule',
  'Schedule Custom Cron': 'schedule',

  'WhatsApp Message Received': 'whatsapp',
  'Telegram New Message': 'telegram',
};

/**
 * Resolve a trigger type from the `availableTriggers` catalog to its kind.
 * Throws rather than guessing: an unrecognised type used to compose a Zap whose
 * trigger could never fire, which is the worst possible failure — a green
 * checkmark followed by silence.
 */
export function kindOf(triggerType: string): TriggerKind {
  const kind = KIND_BY_TYPE[triggerType];
  if (!kind) {
    throw new ZapCompositionError(
      'TRIGGER_KIND_UNKNOWN',
      `Trigger type "${triggerType}" has no composition adapter`
    );
  }
  return kind;
}

export interface ZapStep {
  actionId: string;
  metadata: Record<string, unknown>;
  stepConditions: unknown[];
}

export interface ZapDraft {
  /** `AvailableTriggers.id` — the type is read inside the transaction. */
  triggerId: string;
  triggerMetadata: Record<string, unknown>;
  steps: ZapStep[];
}

/** The root Prisma client or a transaction client; adapters use models only. */
type Db = any;

interface TriggerContext {
  triggerType: string;
  metadata: Record<string, any>;
  userId: number;
}

interface ShadowContext {
  zapId: string;
  triggerType: string;
  metadata: Record<string, any>;
}

interface TriggerAdapter {
  /** Pure-ish checks (reads allowed, writes not) run before the transaction. */
  validate(db: Db, ctx: TriggerContext): Promise<void>;
  createShadowRow(tx: Db, ctx: ShadowContext): Promise<void>;
  deleteShadowRows(tx: Db, zapId: string): Promise<void>;
}

async function requireOwnedConnection(
  db: Db,
  model: 'gmailServer' | 'whatsAppServer' | 'telegramBot',
  id: string,
  userId: number,
  label: string
): Promise<void> {
  const owned = await db[model].findFirst({ where: { id, userId } });
  if (!owned) {
    throw new ZapCompositionError('CONNECTION_NOT_OWNED', `${label} not found`);
  }
}

const GMAIL_TYPE_MAP: Record<string, string> = {
  'Gmail New Email': 'new_email',
  'Gmail Labeled': 'labeled',
  'Gmail Starred': 'starred',
  // From-Sender is a new-email trigger carrying a sender filter.
  'Gmail From Sender': 'new_email',
  'Gmail Matching Search': 'matching_search',
};

const gmailAdapter: TriggerAdapter = {
  async validate(db, { triggerType, metadata, userId }) {
    if (!metadata?.serverId) {
      throw new ZapCompositionError(
        'MISSING_CONNECTION',
        'Gmail trigger requires a connected Gmail server'
      );
    }
    await requireOwnedConnection(db, 'gmailServer', metadata.serverId, userId, 'Gmail server');
    const internal = GMAIL_TYPE_MAP[triggerType];
    const searchQuery = typeof metadata.searchQuery === 'string' ? metadata.searchQuery.trim() : '';
    if (internal === 'matching_search' && !searchQuery) {
      throw new ZapCompositionError(
        'INVALID_TRIGGER_METADATA',
        'Gmail Matching Search trigger requires a search query'
      );
    }
  },

  async createShadowRow(tx, { zapId, triggerType, metadata }) {
    const internal = GMAIL_TYPE_MAP[triggerType];
    if (!internal) return;

    const searchQuery = typeof metadata.searchQuery === 'string' ? metadata.searchQuery.trim() : '';
    const watchedLabels = Array.isArray(metadata.watchedLabels)
      ? metadata.watchedLabels
      : typeof metadata.watchedLabels === 'string' && metadata.watchedLabels.trim()
        ? metadata.watchedLabels
            .split(',')
            .map((label: string) => label.trim())
            .filter(Boolean)
        : [];

    await tx.gmailTrigger.create({
      data: {
        serverId: metadata.serverId,
        zapId,
        triggerType: internal,
        watchedLabels,
        senderFilter: metadata.senderFilter || null,
        subjectFilter: metadata.subjectFilter || null,
        metadata: { ...metadata, ...(searchQuery ? { searchQuery } : {}) },
      },
    });
  },

  async deleteShadowRows(tx, zapId) {
    await tx.gmailTrigger.deleteMany({ where: { zapId } });
  },
};

const sheetsAdapter: TriggerAdapter = {
  async validate(_db, { metadata }) {
    if (!metadata?.serverId || !metadata?.spreadsheetId || !metadata?.sheetName) {
      throw new ZapCompositionError(
        'INVALID_TRIGGER_METADATA',
        'Google Sheets trigger requires a server, a spreadsheet and a sheet name'
      );
    }
  },

  async createShadowRow(tx, { zapId, metadata }) {
    await tx.googleSheetsTrigger.create({
      data: {
        serverId: metadata.serverId,
        zapId,
        spreadsheetId: metadata.spreadsheetId,
        sheetName: metadata.sheetName,
        isActive: true,
      },
    });
  },

  async deleteShadowRows(tx, zapId) {
    await tx.googleSheetsTrigger.deleteMany({ where: { zapId } });
  },
};

const CALENDAR_TYPE_MAP: Record<string, string> = {
  'Google Calendar New Event': 'new_event',
  'Google Calendar Event Updated': 'event_updated',
  'Google Calendar Event Start': 'event_start',
  'Google Calendar Event Ended': 'event_ended',
  'Google Calendar Event Cancelled': 'event_cancelled',
  'Google Calendar New Calendar': 'new_calendar',
  'Google Calendar Event Matching Search': 'event_matching_search',
};

const calendarAdapter: TriggerAdapter = {
  async validate(_db, { metadata }) {
    if (!metadata?.serverId) {
      throw new ZapCompositionError(
        'MISSING_CONNECTION',
        'Google Calendar trigger requires a connected Google account'
      );
    }
  },

  async createShadowRow(tx, { zapId, triggerType, metadata }) {
    const internalTriggerType = CALENDAR_TYPE_MAP[triggerType] ?? 'new_event';
    const isInstant = ['new_event', 'event_updated'].includes(internalTriggerType);

    await tx.googleCalendarTrigger.create({
      data: {
        serverId: metadata.serverId,
        zapId,
        calendarId: metadata.calendarId || 'primary',
        triggerType: internalTriggerType,
        isInstant,
        searchQuery: metadata.searchQuery || null,
        reminderMinutes: metadata.reminderMinutes || null,
        isActive: true,
      },
    });
  },

  async deleteShadowRows(tx, zapId) {
    await tx.googleCalendarTrigger.deleteMany({ where: { zapId } });
  },
};

const SCHEDULE_TYPE_MAP: Record<string, ScheduleType> = {
  'Schedule Every Minute': 'minutely',
  'Schedule Every Hour': 'hourly',
  'Schedule Every Day': 'daily',
  'Schedule Every Week': 'weekly',
  'Schedule Every Month': 'monthly',
  'Schedule Custom Cron': 'cron',
};

const scheduleAdapter: TriggerAdapter = {
  async validate(_db, { metadata }) {
    const cron = typeof metadata?.cron === 'string' ? metadata.cron.trim() : '';
    if (!cron) return;
    const check = validateCron(cron);
    if (!check.valid) {
      throw new ZapCompositionError('INVALID_CRON', check.error ?? 'Invalid cron expression');
    }
  },

  async createShadowRow(tx, { zapId, triggerType, metadata }) {
    const scheduleType = SCHEDULE_TYPE_MAP[triggerType] ?? 'hourly';
    const cronExpression =
      scheduleType === 'cron' ? normalizeCron(String(metadata?.cron ?? '')) : null;

    // First run on the user's wall clock, honouring timezone and day rules.
    const nextRunAt = computeNextRun({
      scheduleType,
      hour: metadata?.hour ?? null,
      minute: metadata?.minute ?? 0,
      dayOfWeek: metadata?.dayOfWeek ?? null,
      dayOfMonth: metadata?.dayOfMonth ?? null,
      cronExpression,
      timezone: metadata?.timezone || 'UTC',
    });

    await tx.scheduledTrigger.create({
      data: {
        zapId,
        scheduleType,
        hour: metadata?.hour ?? null,
        minute: metadata?.minute ?? 0,
        dayOfWeek: metadata?.dayOfWeek ?? null,
        dayOfMonth: metadata?.dayOfMonth ?? null,
        cronExpression,
        timezone: metadata?.timezone || 'UTC',
        nextRunAt,
        isActive: true,
      },
    });
  },

  async deleteShadowRows(tx, zapId) {
    await tx.scheduledTrigger.deleteMany({ where: { zapId } });
  },
};

const whatsappAdapter: TriggerAdapter = {
  async validate(db, { metadata, userId }) {
    if (!metadata?.serverId) {
      throw new ZapCompositionError(
        'MISSING_CONNECTION',
        'WhatsApp trigger requires a connected WhatsApp server'
      );
    }
    await requireOwnedConnection(
      db,
      'whatsAppServer',
      metadata.serverId,
      userId,
      'WhatsApp server'
    );
  },

  async createShadowRow(tx, { zapId, metadata }) {
    await tx.whatsAppTrigger.create({
      data: {
        serverId: metadata.serverId,
        zapId,
        eventType: metadata.eventType || 'message_received',
      },
    });
  },

  async deleteShadowRows(tx, zapId) {
    await tx.whatsAppTrigger.deleteMany({ where: { zapId } });
  },
};

const telegramAdapter: TriggerAdapter = {
  async validate(db, { metadata, userId }) {
    if (!metadata?.botId) {
      throw new ZapCompositionError(
        'MISSING_CONNECTION',
        'Telegram trigger requires a connected Telegram bot'
      );
    }
    await requireOwnedConnection(db, 'telegramBot', metadata.botId, userId, 'Telegram bot');
  },

  async createShadowRow(tx, { zapId, metadata }) {
    await tx.telegramTrigger.create({
      data: {
        botId: metadata.botId,
        zapId,
        eventType: metadata.eventType || 'message',
        filterCommand: metadata.filterCommand || null,
      },
    });
  },

  async deleteShadowRows(tx, zapId) {
    await tx.telegramTrigger.deleteMany({ where: { zapId } });
  },
};

/**
 * Webhook and GitHub triggers are satisfied by the generic Trigger row: their
 * events arrive through ingress and are matched on the Zap's trigger, so no
 * shadow row exists to create or delete. This is a real adapter, not a null
 * check — compose and teardown take the same path for every kind.
 */
const noneAdapter: TriggerAdapter = {
  async validate() {},
  async createShadowRow() {},
  async deleteShadowRows() {},
};

const ADAPTERS: Record<TriggerKind, TriggerAdapter> = {
  gmail: gmailAdapter,
  sheets: sheetsAdapter,
  calendar: calendarAdapter,
  schedule: scheduleAdapter,
  whatsapp: whatsappAdapter,
  telegram: telegramAdapter,
  webhook: noneAdapter,
  github: noneAdapter,
};

/**
 * Compose one Zap: validate, then write base rows and the kind's shadow row in
 * a single transaction.
 *
 * Validation runs *before* the transaction so a bad cron or an unowned
 * connection cannot leave partial rows behind.
 */
export async function composeZap(
  draft: ZapDraft,
  options: { userId: number }
): Promise<{ zapId: string }> {
  const { userId } = options;
  const metadata = (draft.triggerMetadata ?? {}) as Record<string, any>;

  const availableTrigger = await client.availableTriggers.findUnique({
    where: { id: draft.triggerId },
  });
  if (!availableTrigger) {
    throw new ZapCompositionError('UNKNOWN_TRIGGER', 'Selected trigger is unavailable');
  }

  const adapter = ADAPTERS[kindOf(availableTrigger.type)];

  let validatedActions: Array<{ availableActionId: string; actionMetaData?: unknown }>;
  try {
    validatedActions = await validateActionMetadata(
      draft.steps.map((step) => ({
        availableActionId: step.actionId,
        actionMetaData: step.metadata,
      })),
      userId
    );
  } catch (error) {
    if (error instanceof AiMetadataError) {
      throw new ZapCompositionError('INVALID_ACTION_METADATA', error.message);
    }
    throw error;
  }

  await adapter.validate(client, {
    triggerType: availableTrigger.type,
    metadata,
    userId,
  });

  const zapId = await client.$transaction(async (tx: Db) => {
    const zap = await tx.zap.create({
      data: {
        userId,
        triggerId: '',
        actions: {
          create: draft.steps.map((step, index) => ({
            actionId: step.actionId,
            metadata: (validatedActions[index]?.actionMetaData ?? step.metadata) as any,
            stepConditions: (step.stepConditions ?? []) as any,
            sortingOrder: index + 1,
          })),
        },
      },
    });

    const trigger = await tx.trigger.create({
      data: {
        triggerId: draft.triggerId,
        zapId: zap.id,
        metadata: metadata as any,
      },
    });

    await tx.zap.update({ where: { id: zap.id }, data: { triggerId: trigger.id } });

    await adapter.createShadowRow(tx, {
      zapId: zap.id,
      triggerType: availableTrigger.type,
      metadata,
    });

    return zap.id as string;
  });

  return { zapId };
}

/**
 * Remove one Zap and everything hanging off it.
 *
 * Order matters: children before parents (outbox → runs → shadow rows →
 * gmail actions → trigger → steps → zap). Shadow rows are deleted through every
 * adapter rather than the Zap's own kind, because a `deleteMany` by `zapId` is a
 * no-op when the row does not exist — that keeps teardown correct even if the
 * trigger's kind changed after creation.
 */
export async function removeZap(
  zapId: string,
  options: { userId: number }
): Promise<{ deletedZap: any }> {
  const deletedZap = await client.$transaction(async (tx: Db) => {
    const runs = await tx.zapRun.findMany({ where: { zapId }, select: { id: true } });
    if (runs.length > 0) {
      await tx.zapRunOutbox.deleteMany({
        where: { zapRunId: { in: runs.map((run: { id: string }) => run.id) } },
      });
    }
    await tx.zapRun.deleteMany({ where: { zapId } });

    for (const adapter of new Set(Object.values(ADAPTERS))) {
      await adapter.deleteShadowRows(tx, zapId);
    }

    // Gmail action rows are step-scoped, not trigger-kind-scoped.
    await tx.gmailAction.deleteMany({ where: { zapId } });

    try {
      await tx.trigger.delete({ where: { zapId } });
    } catch {
      // A Zap may exist without a trigger row; keep going.
    }

    await tx.action.deleteMany({ where: { zapId } });

    return tx.zap.delete({ where: { id: zapId, userId: options.userId } });
  });

  return { deletedZap };
}
