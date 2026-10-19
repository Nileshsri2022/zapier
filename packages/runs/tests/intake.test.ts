import { createRunIntake, type RunDispatcher } from '../src';

function fakeDb(
  options: {
    zap?: { isActive: boolean } | null;
    rows?: any[];
    failTransaction?: boolean;
    failDeletes?: boolean;
  } = {}
) {
  const runs: any[] = [];
  const outboxRows: any[] = [];

  const api: any = {
    zap: {
      // `null` is a real value here (missing Zap); only `undefined` means
      // "no fixture provided".
      findUnique: jest.fn(async () =>
        options.zap !== undefined ? options.zap : { isActive: true }
      ),
    },
    zapRun: {
      create: jest.fn(async ({ data }: any) => {
        const run = { id: `run-${runs.length + 1}`, ...data };
        runs.push(run);
        return run;
      }),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    zapRunOutbox: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `out-${outboxRows.length + 1}`, ...data };
        outboxRows.push(row);
        return row;
      }),
      findMany: jest.fn(async () => options.rows ?? []),
      deleteMany: jest.fn(async ({ where }: any) => {
        if (options.failDeletes) throw new Error('delete failed');
        return { count: where?.id?.in?.length ?? 1 };
      }),
    },
    $transaction: jest.fn(async (arg: any) => {
      if (options.failTransaction) throw new Error('db write failed');
      if (typeof arg === 'function') return arg(api);
      return Promise.all(arg);
    }),
  };

  return { db: api, runs, outboxRows };
}

function fakeDedup(seen: string[] = []) {
  const claimed = new Set(seen);
  return {
    claimed,
    isDuplicate: jest.fn(async (scope: string, key: string) => {
      const id = `${scope}:${key}`;
      if (claimed.has(id)) return true;
      claimed.add(id);
      return false;
    }),
    release: jest.fn(async (scope: string, key: string) => {
      claimed.delete(`${scope}:${key}`);
    }),
  };
}

function fakeDispatcher(): RunDispatcher & { send: jest.Mock } {
  return { send: jest.fn(async () => undefined) };
}

const silentLogger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };

describe('run intake — enqueue', () => {
  it('writes ZapRun + outbox in one transaction, dispatches stage 1 and cleans the row', async () => {
    const { db, runs, outboxRows } = fakeDb();
    const dedup = fakeDedup();
    const dispatcher = fakeDispatcher();
    const intake = createRunIntake({ db, dedup, dispatcher, logger: silentLogger });

    const result = await intake.enqueue({
      zapId: 'zap-1',
      metadata: { hello: 'world' },
      dedup: { scope: 'webhook', key: 'zap-1:event-1' },
      source: 'test',
    });

    expect(result).toEqual({ status: 'queued', zapRunId: 'run-1', dispatched: true });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(runs[0].metadata).toEqual({ hello: 'world' });
    expect(outboxRows).toHaveLength(1);
    expect(dispatcher.send).toHaveBeenCalledWith([{ zapRunId: 'run-1', stage: 1 }]);
    expect(db.zapRunOutbox.deleteMany).toHaveBeenCalledWith({
      where: { zapRunId: 'run-1' },
    });
  });

  it('skips missing and inactive Zaps without claiming dedup or writing rows', async () => {
    const cases = [
      { zap: null, reason: 'zap_not_found' },
      { zap: { isActive: false }, reason: 'zap_inactive' },
    ] as const;

    for (const { zap, reason } of cases) {
      const { db } = fakeDb({ zap });
      const dedup = fakeDedup();
      const dispatcher = fakeDispatcher();
      const intake = createRunIntake({ db, dedup, dispatcher, logger: silentLogger });

      const result = await intake.enqueue({
        zapId: 'zap-1',
        dedup: { scope: 'webhook', key: 'event-1' },
      });

      expect(result).toEqual({ status: 'skipped', reason });
      expect(dedup.isDuplicate).not.toHaveBeenCalled();
      expect(db.$transaction).not.toHaveBeenCalled();
      expect(dispatcher.send).not.toHaveBeenCalled();
    }
  });

  it('returns typed skips from the transaction when no dedup key is given', async () => {
    for (const { zap, reason } of [
      { zap: null, reason: 'zap_not_found' },
      { zap: { isActive: false }, reason: 'zap_inactive' },
    ] as const) {
      const { db } = fakeDb({ zap });
      const dedup = fakeDedup();
      const dispatcher = fakeDispatcher();
      const intake = createRunIntake({ db, dedup, dispatcher, logger: silentLogger });

      const result = await intake.enqueue({ zapId: 'zap-1' });

      expect(result).toEqual({ status: 'skipped', reason });
      // No dedup key: one read (inside the transaction), no claim.
      expect(db.zap.findUnique).toHaveBeenCalledTimes(1);
      expect(dedup.isDuplicate).not.toHaveBeenCalled();
      expect(db.$transaction).toHaveBeenCalledTimes(1);
    }
  });

  it('returns duplicate and writes nothing when the dedup slot is taken', async () => {
    const { db } = fakeDb();
    const dedup = fakeDedup(['webhook:zap-1:event-1']);
    const dispatcher = fakeDispatcher();
    const intake = createRunIntake({ db, dedup, dispatcher, logger: silentLogger });

    const result = await intake.enqueue({
      zapId: 'zap-1',
      dedup: { scope: 'webhook', key: 'zap-1:event-1' },
    });

    expect(result).toEqual({ status: 'duplicate' });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(dispatcher.send).not.toHaveBeenCalled();
  });

  it('releases the dedup slot when the transaction fails', async () => {
    const { db } = fakeDb({ failTransaction: true });
    const dedup = fakeDedup();
    const dispatcher = fakeDispatcher();
    const intake = createRunIntake({ db, dedup, dispatcher, logger: silentLogger });

    await expect(
      intake.enqueue({
        zapId: 'zap-1',
        dedup: { scope: 'gmail', key: 'zap-1:msg-1:new_email' },
      })
    ).rejects.toThrow('db write failed');

    expect(dedup.release).toHaveBeenCalledWith('gmail', 'zap-1:msg-1:new_email');
    expect(dedup.claimed.size).toBe(0);
  });

  it('does not mask the write error when releasing the dedup slot itself fails', async () => {
    const { db } = fakeDb({ failTransaction: true });
    const dedup = fakeDedup();
    (dedup.release as jest.Mock).mockRejectedValueOnce(new Error('redis down'));
    const dispatcher = fakeDispatcher();
    const intake = createRunIntake({ db, dedup, dispatcher, logger: silentLogger });

    await expect(
      intake.enqueue({
        zapId: 'zap-1',
        dedup: { scope: 'gmail', key: 'zap-1:msg-1:new_email' },
      })
    ).rejects.toThrow('db write failed');
  });

  it('keeps the outbox row when immediate dispatch fails', async () => {
    const { db, outboxRows } = fakeDb();
    const dedup = fakeDedup();
    const dispatcher: RunDispatcher & { send: jest.Mock } = {
      send: jest.fn(async () => {
        throw new Error('kafka down');
      }),
    };
    const intake = createRunIntake({ db, dedup, dispatcher, logger: silentLogger });

    const result = await intake.enqueue({ zapId: 'zap-1', source: 'test' });

    expect(result).toEqual({ status: 'queued', zapRunId: 'run-1', dispatched: false });
    expect(outboxRows).toHaveLength(1);
    expect(db.zapRunOutbox.deleteMany).not.toHaveBeenCalled();
  });

  it('re-checks active state inside the transaction and releases the slot', async () => {
    const { db } = fakeDb();
    let calls = 0;
    db.zap.findUnique.mockImplementation(async () => {
      calls += 1;
      return calls === 1 ? { isActive: true } : { isActive: false };
    });
    const dedup = fakeDedup();
    const dispatcher = fakeDispatcher();
    const intake = createRunIntake({ db, dedup, dispatcher, logger: silentLogger });

    const result = await intake.enqueue({
      zapId: 'zap-1',
      dedup: { scope: 'gmail', key: 'key' },
    });

    expect(result).toEqual({ status: 'skipped', reason: 'zap_inactive' });
    expect(dedup.release).toHaveBeenCalledWith('gmail', 'key');
    expect(dispatcher.send).not.toHaveBeenCalled();
  });
});

describe('run intake — drainOutbox', () => {
  it('dispatches active pending rows, parks inactive runs and cleans stale rows', async () => {
    const rows = [
      {
        id: 'out-active',
        zapRunId: 'run-active',
        zapRun: { id: 'run-active', status: 'pending', zap: { isActive: true } },
      },
      {
        id: 'out-inactive',
        zapRunId: 'run-inactive',
        zapRun: { id: 'run-inactive', status: 'pending', zap: { isActive: false } },
      },
      {
        id: 'out-stale',
        zapRunId: 'run-stale',
        zapRun: { id: 'run-stale', status: 'running', zap: { isActive: true } },
      },
    ];
    const { db } = fakeDb({ rows });
    const dedup = fakeDedup();
    const dispatcher = fakeDispatcher();
    const intake = createRunIntake({ db, dedup, dispatcher, logger: silentLogger });

    const result = await intake.drainOutbox(50);

    expect(result).toEqual({ dispatched: 1, parked: 1, cleaned: 1, failed: 0 });
    expect(dispatcher.send).toHaveBeenCalledWith([{ zapRunId: 'run-active', stage: 1 }]);
    expect(db.zapRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['run-inactive'] }, status: 'pending' },
        data: expect.objectContaining({
          status: 'failed',
          errorMessage: 'Zap inactive before dispatch',
        }),
      })
    );
    expect(db.zapRunOutbox.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['out-active'] } },
    });
    expect(db.zapRunOutbox.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['out-inactive'] } },
    });
    expect(db.zapRunOutbox.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['out-stale'] } },
    });
  });

  it('leaves active rows for the next drain when dispatch fails', async () => {
    const rows = [
      {
        id: 'out-1',
        zapRunId: 'run-1',
        zapRun: { id: 'run-1', status: 'pending', zap: { isActive: true } },
      },
    ];
    const { db } = fakeDb({ rows });
    const dedup = fakeDedup();
    const dispatcher: RunDispatcher & { send: jest.Mock } = {
      send: jest.fn(async () => {
        throw new Error('kafka down');
      }),
    };
    const intake = createRunIntake({ db, dedup, dispatcher, logger: silentLogger });

    const result = await intake.drainOutbox();

    expect(result).toEqual({ dispatched: 0, parked: 0, cleaned: 0, failed: 1 });
    expect(db.zapRunOutbox.deleteMany).not.toHaveBeenCalled();
  });

  it('returns zero counts without calling the dispatcher for an empty outbox', async () => {
    const { db } = fakeDb({ rows: [] });
    const dedup = fakeDedup();
    const dispatcher = fakeDispatcher();
    const intake = createRunIntake({ db, dedup, dispatcher, logger: silentLogger });

    await expect(intake.drainOutbox()).resolves.toEqual({
      dispatched: 0,
      parked: 0,
      cleaned: 0,
      failed: 0,
    });
    expect(dispatcher.send).not.toHaveBeenCalled();
  });
});
