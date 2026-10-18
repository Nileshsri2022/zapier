import {
  buildAuditReport,
  auditGmailZaps,
  formatAuditReport,
  isGmailActionType,
  isCurrentlyFailingOnGmailPath,
  riskyZapIds,
  applyDeactivateRisky,
} from '../../src/scripts/auditGmailZaps';
import { computeBackfillPlan } from '../../src/scripts/backfillGmailServerEmail';
import {
  rewriteTemplateString,
  rewriteMetadataTemplates,
  buildRewritePlan,
  applyRewritePlan,
} from '../../src/scripts/rewriteGmailZapTemplates';

/**
 * P1 pre-flight audit classification (reports/gmail-worker-routing-spec.md).
 * The audit is the evidence base for the P4 rollout gates (D7 deactivation
 * set, D8 template rewrite, Q3 currently-failing set) — misclassification
 * here would either miss a fake->real Solana Zap or nag owners needlessly.
 */

const zapRow = (zapOverrides: any, triggerOverrides: any = {}) => ({
  triggerType: 'new_email',
  ...triggerOverrides,
  zap: {
    id: 'zap-1',
    name: 'Test Zap',
    userId: 7,
    isActive: true,
    actions: [],
    ...zapOverrides,
  },
});

const action = (type: string, metadata: any = {}, sortingOrder = 1) => ({
  action: { type },
  metadata,
  sortingOrder,
});

describe('buildAuditReport', () => {
  it('classifies the P4 risk sets per Zap', () => {
    const report = buildAuditReport([
      zapRow({
        id: 'zap-sol',
        actions: [action('Email', { body: 'Hi {{subject}}' }), action('Solana', {}, 2)],
      }),
      zapRow({ id: 'zap-wa', actions: [action('WhatsApp Send Message')] }),
      zapRow({ id: 'zap-gmail', actions: [action('Gmail Send Email')] }),
      zapRow({ id: 'zap-clean', actions: [action('Email', { body: 'Hi {subject}' })] }),
    ]);

    expect(report.counts).toEqual({
      totalZaps: 4,
      activeZaps: 4,
      solana: 1,
      gmailActions: 1,
      currentlyFailing: 1,
      legacyTemplates: 1,
    });

    const byId = Object.fromEntries(report.zaps.map((z) => [z.zapId, z]));
    expect(byId['zap-sol']).toMatchObject({ hasSolana: true, hasLegacyTemplates: true });
    expect(byId['zap-sol'].actionTypes).toEqual(['Email', 'Solana']); // sortingOrder respected
    expect(byId['zap-wa'].hasCurrentlyFailingAction).toBe(true);
    expect(byId['zap-gmail'].hasGmailAction).toBe(true);
    expect(byId['zap-clean']).toMatchObject({
      hasSolana: false,
      hasGmailAction: false,
      hasCurrentlyFailingAction: false,
      hasLegacyTemplates: false,
    });
  });

  it('groups multiple GmailTrigger rows of one Zap and dedupes trigger types', () => {
    const report = buildAuditReport([
      zapRow({ id: 'zap-1' }, { triggerType: 'new_email' }),
      zapRow({ id: 'zap-1' }, { triggerType: 'starred' }),
      zapRow({ id: 'zap-1' }, { triggerType: 'new_email' }),
    ]);

    expect(report.gmailTriggerRows).toBe(3);
    expect(report.counts.totalZaps).toBe(1);
    expect(report.zaps[0].triggerTypes).toEqual(['new_email', 'starred']);
  });

  it('detects legacy {{templates}} nested anywhere in action metadata', () => {
    const report = buildAuditReport([
      zapRow({
        actions: [action('Webhook', { body: { nested: ['x', '{{from}}'] } })],
      }),
    ]);
    expect(report.zaps[0].hasLegacyTemplates).toBe(true);
    // A Webhook action is also in the currently-failing-on-Gmail set.
    expect(report.zaps[0].hasCurrentlyFailingAction).toBe(true);
  });

  it('ignores rows without a Zap', () => {
    const report = buildAuditReport([{ triggerType: 'new_email', zap: null } as any]);
    expect(report.counts.totalZaps).toBe(0);
  });
});

describe('auditGmailZaps (db access)', () => {
  it('is strictly read-only: one findMany, no write methods touched', async () => {
    const writes = {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    };
    const findMany = jest.fn().mockResolvedValue([zapRow({ actions: [action('Solana')] })]);
    const fakeDb = { gmailTrigger: { findMany, ...writes } } as any;

    const report = await auditGmailZaps(fakeDb);

    expect(findMany).toHaveBeenCalledTimes(1);
    for (const write of Object.values(writes)) expect(write).not.toHaveBeenCalled();
    expect(report.counts.solana).toBe(1);
  });
});

describe('formatAuditReport + type classifiers', () => {
  it('surfaces zap ids and risk flags for the rollout PR', () => {
    const text = formatAuditReport(
      buildAuditReport([zapRow({ id: 'zap-9', actions: [action('Solana')] })])
    );
    expect(text).toContain('zap-9');
    expect(text).toContain('SOLANA(fake->real!)');
  });

  it.each([
    ['Gmail Send Email', true, false],
    ['GmailSend', true, false],
    ['WhatsApp Send Message', false, true],
    ['Telegram Send Message', false, true],
    ['Webhook', false, true],
    ['Email', false, false],
    ['Solana', false, false],
  ])('%s -> gmail:%s currentlyFailing:%s', (type, gmail, failing) => {
    expect(isGmailActionType(type as string)).toBe(gmail);
    expect(isCurrentlyFailingOnGmailPath(type as string)).toBe(failing);
  });
});

describe('computeBackfillPlan (GmailServer.email backfill, spec D3)', () => {
  it('plans email (+ cursor only when unset) and records profile failures', async () => {
    const servers = [
      { id: 'needs-both', email: null, lastHistoryId: null },
      { id: 'has-cursor', email: null, lastHistoryId: '777' },
      { id: 'already-done', email: 'done@gmail.com', lastHistoryId: '888' },
      { id: 'dead-token', email: null, lastHistoryId: null },
    ];
    const fetchProfile = jest.fn(async (server: any) => {
      if (server.id === 'dead-token') return null;
      return { email: `${server.id}@gmail.com`, historyId: '999' };
    });

    const plan = await computeBackfillPlan(servers, fetchProfile);

    expect(plan.updates).toEqual([
      { id: 'needs-both', email: 'needs-both@gmail.com', lastHistoryId: '999' },
      { id: 'has-cursor', email: 'has-cursor@gmail.com' },
    ]);
    expect(plan.failures).toEqual(['dead-token']);
    // Servers that already have an email are never re-fetched (idempotent).
    expect(fetchProfile).toHaveBeenCalledTimes(3);
    expect(fetchProfile).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'already-done' }));
  });

  it('treats a throwing profile fetch as a failure, not a crash', async () => {
    const plan = await computeBackfillPlan([{ id: 'boom', email: null }], async () => {
      throw new Error('invalid_grant');
    });
    expect(plan).toEqual({ updates: [], failures: ['boom'] });
  });
});

describe('D7 risky-set deactivation (audit --apply-deactivate-risky)', () => {
  const report = () =>
    buildAuditReport([
      zapRow({ id: 'sol-active', actions: [action('Solana')] }),
      zapRow({ id: 'gmail-active', actions: [action('Gmail Send Email')] }),
      zapRow({ id: 'sol-inactive', isActive: false, actions: [action('Solana')] }),
      zapRow({ id: 'wa-active', actions: [action('WhatsApp Send Message')] }),
    ]);

  it('selects only ACTIVE Solana/GmailAction zaps (not the merely currently-failing set)', () => {
    expect(riskyZapIds(report()).sort()).toEqual(['gmail-active', 'sol-active']);
  });

  it('deactivates via one guarded updateMany and reports the ids', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 2 });
    const result = await applyDeactivateRisky({ zap: { updateMany } } as any, report());

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: expect.arrayContaining(['sol-active', 'gmail-active']) }, isActive: true },
      data: { isActive: false },
    });
    expect(result).toMatchObject({ count: 2 });
    expect(result.deactivatedIds.sort()).toEqual(['gmail-active', 'sol-active']);
  });

  it('writes nothing when the risky set is empty', async () => {
    const updateMany = jest.fn();
    const clean = buildAuditReport([zapRow({ actions: [action('Email')] })]);
    await expect(applyDeactivateRisky({ zap: { updateMany } } as any, clean)).resolves.toEqual({
      deactivatedIds: [],
      count: 0,
    });
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe('D8 template rewrite (rewriteGmailZapTemplates)', () => {
  it('rewrites {{word}} to {word} and leaves everything else alone', () => {
    expect(rewriteTemplateString('Hi {{from}}, re: {{subject}}')).toBe('Hi {from}, re: {subject}');
    expect(rewriteTemplateString('already {subject}')).toBe('already {subject}');
    expect(rewriteTemplateString('no templates')).toBe('no templates');
    expect(rewriteTemplateString('{{not a key}}')).toBe('{{not a key}}');
  });

  it('walks nested metadata, records paths without leaking values into the plan shape', () => {
    const metadata = {
      to: '{{email}}',
      body: { lines: ['Dear {{name}}', 'see {orderId}'] },
      amount: 42,
      flag: true,
    };
    const result = rewriteMetadataTemplates(metadata);

    expect(result.changed).toBe(true);
    expect(result.replacements).toBe(2);
    expect(result.paths.sort()).toEqual(['body.lines[0]', 'to']);
    expect(result.value).toEqual({
      to: '{email}',
      body: { lines: ['Dear {name}', 'see {orderId}'] },
      amount: 42,
      flag: true,
    });
    // Input is not mutated.
    expect(metadata.to).toBe('{{email}}');
  });

  it('is idempotent: a second pass changes nothing', () => {
    const once = rewriteMetadataTemplates({ body: '{{subject}}' });
    const twice = rewriteMetadataTemplates(once.value);
    expect(once.changed).toBe(true);
    expect(twice.changed).toBe(false);
    expect(twice.value).toEqual({ body: '{subject}' });
  });

  it('builds a plan containing only changed actions, applies via action.update', async () => {
    const zaps = [
      {
        id: 'zap-1',
        actions: [
          { id: 'a1', action: { type: 'Email' }, metadata: { body: '{{subject}}' } },
          { id: 'a2', action: { type: 'Webhook' }, metadata: { url: 'https://x.example' } },
        ],
      },
    ];

    const plan = buildRewritePlan(zaps as any);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      actionDbId: 'a1',
      zapId: 'zap-1',
      actionType: 'Email',
      paths: ['body'],
    });

    const update = jest.fn().mockResolvedValue({});
    await expect(applyRewritePlan({ action: { update } } as any, plan)).resolves.toBe(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { metadata: { body: '{subject}' } },
    });
  });
});
