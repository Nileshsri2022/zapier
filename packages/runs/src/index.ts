/**
 * Run intake and outbox drain — the deep module every trigger uses.
 *
 * Before this module existed, ten ingress call sites each re-implemented
 * "create a ZapRun and queue it" with different durability guarantees:
 * three published to Kafka directly (no outbox fallback), five wrote
 * ZapRun then ZapRunOutbox in two separate statements, and only two used
 * one transaction. This module owns that whole step:
 *
 *   active-Zap check → optional dedup claim → ZapRun + outbox in one
 *   transaction → best-effort immediate dispatch → outbox cleanup
 *
 * The outbox row remains the fallback whenever immediate dispatch fails,
 * so an event can never be stranded by a Kafka hiccup. Delivery is
 * at-least-once; worker-side stage idempotency is a separate follow-up.
 */

export interface RunMessage {
  zapRunId: string;
  stage: number;
}

export interface RunDispatcher {
  send(messages: RunMessage[]): Promise<void>;
}

export interface DedupStore {
  /** True when this (scope, key) pair was already claimed. */
  isDuplicate(scope: string, key: string): Promise<boolean>;
  /** Best-effort release after the durable write it guarded failed. */
  release(scope: string, key: string): Promise<void>;
}

export interface RunLogger {
  info?(...args: unknown[]): void;
  warn?(...args: unknown[]): void;
  error?(...args: unknown[]): void;
}

export interface RunIntakeDeps {
  db: any;
  dedup: DedupStore;
  dispatcher: RunDispatcher;
  logger?: RunLogger;
  now?: () => Date;
}

export interface EnqueueRunInput {
  zapId: string;
  metadata?: unknown;
  /** Provider event identity; omit when the ingress has no stable id. */
  dedup?: {
    scope: string;
    key?: string | null;
  };
  /** Log context only — never persisted. */
  source?: string;
}

export type EnqueueRunResult =
  | { status: 'queued'; zapRunId: string; dispatched: boolean }
  | { status: 'duplicate' }
  | { status: 'skipped'; reason: 'zap_not_found' | 'zap_inactive' };

export interface DrainOutboxResult {
  dispatched: number;
  parked: number;
  cleaned: number;
  failed: number;
}

export interface RunIntake {
  enqueue(input: EnqueueRunInput): Promise<EnqueueRunResult>;
  drainOutbox(limit?: number): Promise<DrainOutboxResult>;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
const INACTIVE_ERROR = 'Zap inactive before dispatch';

// Ingress answers providers; it must not sit on a Kafka connect timeout.
// A publish slower than this is left to the outbox drain (row retained).
const IMMEDIATE_DISPATCH_TIMEOUT_MS = 3000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function normaliseLimit(limit?: number): number {
  if (limit === undefined || Number.isNaN(limit)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)));
}

function excerpt(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createRunIntake(deps: RunIntakeDeps): RunIntake {
  const { db, dedup, dispatcher } = deps;
  const log = deps.logger ?? console;
  const now = deps.now ?? (() => new Date());

  async function enqueue(input: EnqueueRunInput): Promise<EnqueueRunResult> {
    const source = input.source ?? 'unknown';
    const scope = input.dedup?.scope || 'run';
    const dedupKey = input.dedup?.key;

    // Resolve the Zap before claiming a dedup slot: an inactive Zap must not
    // burn a slot that a legitimate later delivery would need. Callers
    // without a dedup key skip this read — the transactional check below is
    // enough, and pollers enqueue in bulk.
    if (dedupKey) {
      const zap = await db.zap.findUnique({
        where: { id: input.zapId },
        select: { isActive: true },
      });

      if (!zap) {
        return { status: 'skipped', reason: 'zap_not_found' };
      }
      if (!zap.isActive) {
        return { status: 'skipped', reason: 'zap_inactive' };
      }
    }

    let claimed = false;
    if (dedupKey) {
      if (await dedup.isDuplicate(scope, dedupKey)) {
        return { status: 'duplicate' };
      }
      claimed = true;
    }

    // Releasing must never mask the failure that caused it.
    const releaseSlot = async () => {
      if (!claimed || !dedupKey) return;
      try {
        await dedup.release(scope, dedupKey);
      } catch (error) {
        log.warn?.(
          `⚠️ Run intake (${source}) could not release dedup slot ${scope}:${dedupKey}: ${excerpt(error)}`
        );
      }
    };

    type TransactionOutcome =
      | { run: { id: string } }
      | { reason: 'zap_not_found' | 'zap_inactive' };

    let outcome: TransactionOutcome | null = null;
    try {
      outcome = await db.$transaction(async (tx: any): Promise<TransactionOutcome> => {
        // Re-check inside the transaction: the Zap can be deleted or
        // deactivated between the claim above and the write below.
        const fresh = await tx.zap.findUnique({
          where: { id: input.zapId },
          select: { isActive: true },
        });
        if (!fresh) return { reason: 'zap_not_found' };
        if (!fresh.isActive) return { reason: 'zap_inactive' };

        const created = await tx.zapRun.create({
          data: {
            zapId: input.zapId,
            metadata: (input.metadata ?? {}) as any,
          },
        });
        await tx.zapRunOutbox.create({ data: { zapRunId: created.id } });
        return { run: created };
      });
    } catch (error) {
      // The slot guarded a write that never happened; let the provider retry.
      await releaseSlot();
      throw error;
    }

    if (!outcome) {
      await releaseSlot();
      return { status: 'skipped', reason: 'zap_inactive' };
    }

    if ('reason' in outcome) {
      await releaseSlot();
      return { status: 'skipped', reason: outcome.reason };
    }

    const run = outcome.run;

    let dispatched = false;
    try {
      await withTimeout(
        dispatcher.send([{ zapRunId: run.id, stage: 1 }]),
        IMMEDIATE_DISPATCH_TIMEOUT_MS,
        'immediate dispatch'
      );
      dispatched = true;
    } catch (error) {
      log.warn?.(
        `⚠️ Run intake (${source}) could not dispatch ZapRun ${run.id} immediately; outbox row retained for drain: ${excerpt(error)}`
      );
      return { status: 'queued', zapRunId: run.id, dispatched: false };
    }

    try {
      await db.zapRunOutbox.deleteMany({ where: { zapRunId: run.id } });
    } catch (error) {
      // The run is already in Kafka. The stale row is cleaned by drain
      // (ZapRun.status is no longer pending once the worker starts).
      log.warn?.(
        `⚠️ Run intake (${source}) dispatched ZapRun ${run.id} but could not clean its outbox row: ${excerpt(error)}`
      );
    }

    return { status: 'queued', zapRunId: run.id, dispatched };
  }

  async function drainOutbox(limit?: number): Promise<DrainOutboxResult> {
    const take = normaliseLimit(limit);
    const rows: any[] = await db.zapRunOutbox.findMany({
      take,
      orderBy: { id: 'asc' },
      include: {
        zapRun: {
          select: {
            id: true,
            status: true,
            zap: { select: { isActive: true } },
          },
        },
      },
    });

    const result: DrainOutboxResult = {
      dispatched: 0,
      parked: 0,
      cleaned: 0,
      failed: 0,
    };

    if (rows.length === 0) return result;

    // A row whose run already left `pending` was dispatched by an earlier
    // attempt whose cleanup failed. Re-sending it would replay stage 1.
    const stale = rows.filter((row) => row.zapRun?.status !== 'pending');
    const pending = rows.filter((row) => row.zapRun?.status === 'pending');
    const inactive = pending.filter((row) => !row.zapRun?.zap?.isActive);
    const active = pending.filter((row) => row.zapRun?.zap?.isActive);

    if (stale.length > 0) {
      try {
        await db.zapRunOutbox.deleteMany({
          where: { id: { in: stale.map((row) => row.id) } },
        });
        result.cleaned = stale.length;
      } catch (error) {
        result.failed += stale.length;
        log.error?.(
          `❌ Outbox drain could not clean ${stale.length} stale row(s): ${excerpt(error)}`
        );
      }
    }

    if (inactive.length > 0) {
      const runIds = inactive.map((row) => row.zapRunId);
      const outboxIds = inactive.map((row) => row.id);
      try {
        await db.$transaction(async (tx: any) => {
          await tx.zapRun.updateMany({
            where: { id: { in: runIds }, status: 'pending' },
            data: {
              status: 'failed',
              errorMessage: INACTIVE_ERROR,
              completedAt: now(),
            },
          });
          await tx.zapRunOutbox.deleteMany({ where: { id: { in: outboxIds } } });
        });
        result.parked = inactive.length;
      } catch (error) {
        result.failed += inactive.length;
        log.error?.(
          `❌ Outbox drain could not park ${inactive.length} inactive-Zap run(s): ${excerpt(error)}`
        );
      }
    }

    if (active.length > 0) {
      try {
        await dispatcher.send(active.map((row) => ({ zapRunId: row.zapRunId, stage: 1 })));
        result.dispatched = active.length;

        try {
          await db.zapRunOutbox.deleteMany({
            where: { id: { in: active.map((row) => row.id) } },
          });
        } catch (error) {
          log.warn?.(
            `⚠️ Outbox drain dispatched ${active.length} run(s) but could not clean their rows: ${excerpt(error)}`
          );
        }
      } catch (error) {
        result.failed += active.length;
        log.error?.(
          `❌ Outbox drain could not dispatch ${active.length} run(s): ${excerpt(error)}`
        );
      }
    }

    return result;
  }

  return { enqueue, drainOutbox };
}

class KafkaRunDispatcher implements RunDispatcher {
  private producer: any = null;
  private connecting: Promise<any> | null = null;

  constructor(
    private readonly kafka: any,
    private readonly topic: string
  ) {}

  private async getProducer(): Promise<any> {
    if (this.producer) return this.producer;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      const producer = this.kafka.producer({ allowAutoTopicCreation: true });
      await producer.connect();
      this.producer = producer;
      return producer;
    })();

    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  async send(messages: RunMessage[]): Promise<void> {
    const producer = await this.getProducer();
    try {
      await producer.send({
        topic: this.topic,
        messages: messages.map((message) => ({
          value: JSON.stringify(message),
        })),
      });
    } catch (error) {
      // Drop a poisoned producer so the next attempt reconnects instead of
      // reusing a half-open socket.
      await this.disconnect();
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    const producer = this.producer;
    this.producer = null;
    if (!producer) return;
    try {
      await producer.disconnect();
    } catch {
      // Process shutdown is best effort.
    }
  }
}

let singleton: RunIntake | null = null;
let kafkaDispatcher: KafkaRunDispatcher | null = null;

/**
 * Lazy default wiring. Kept out of module scope so unit tests can import
 * `createRunIntake` without constructing Prisma, Redis or Kafka clients.
 */
export function getRunIntake(): RunIntake {
  if (singleton) return singleton;

  /* eslint-disable @typescript-eslint/no-var-requires */
  const db = require('@repo/db').default;
  const redis = require('@repo/redis');
  const kafkaModule = require('@repo/kafka');
  /* eslint-enable @typescript-eslint/no-var-requires */

  kafkaDispatcher = new KafkaRunDispatcher(kafkaModule.default, kafkaModule.TOPICS.ZAP_EVENTS);

  singleton = createRunIntake({
    db,
    dedup: {
      isDuplicate: redis.isDuplicateEvent,
      release: redis.releaseEvent,
    },
    dispatcher: kafkaDispatcher,
  });

  return singleton;
}

/** Enqueue one trigger event through the shared intake path. */
export async function enqueueRun(input: EnqueueRunInput): Promise<EnqueueRunResult> {
  return getRunIntake().enqueue(input);
}

/** Drain a batch of outbox rows; used by the processor endpoint. */
export async function drainOutbox(limit?: number): Promise<DrainOutboxResult> {
  return getRunIntake().drainOutbox(limit);
}

/** Close the shared Kafka producer during graceful shutdown. */
export async function disconnectRunDispatcher(): Promise<void> {
  if (kafkaDispatcher) await kafkaDispatcher.disconnect();
  kafkaDispatcher = null;
  singleton = null;
}
