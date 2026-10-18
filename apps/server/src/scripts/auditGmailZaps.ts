import client from '@repo/db';

/**
 * P1 pre-flight audit for reports/gmail-worker-routing-spec.md.
 *
 * READ-ONLY. Inventories every Zap reachable from a GmailTrigger row and
 * flags what the P4 rollout must handle before Gmail Zaps start executing
 * in apps/worker:
 *
 * - Solana actions      — the server-inline executor only *pretends* to
 *                         send SOL; in the worker these become REAL
 *                         transfers (spec D7: deactivate pending owners).
 * - Gmail* actions      — catalog types the worker rejects (removed from
 *                         the seed in F4, but old Zaps may reference them).
 * - WhatsApp/Telegram/Webhook — silently failing today on the Gmail path;
 *                         they will START WORKING at the flip (spec Q3).
 * - {{legacy}} templates — the inline executor resolved {{key}}; the
 *                         worker resolves {key} (spec D8 rewrite).
 *
 * Run:  bunx tsx src/scripts/auditGmailZaps.ts          (from apps/server)
 * Read-only by default. The single write mode is explicit:
 *   bunx tsx src/scripts/auditGmailZaps.ts --apply-deactivate-risky
 * which deactivates (isActive=false) the D7 risky set — active Zaps with
 * Solana or Gmail* actions — so owners re-enable them consciously after
 * the P4 flip. It never writes anything else, and the template rewrite
 * is a separate script (rewriteGmailZapTemplates.ts).
 */

export interface GmailZapAuditEntry {
  zapId: string;
  zapName: string;
  userId: number;
  isActive: boolean;
  triggerTypes: string[];
  actionTypes: string[];
  hasSolana: boolean;
  hasGmailAction: boolean;
  hasCurrentlyFailingAction: boolean;
  hasLegacyTemplates: boolean;
}

export interface GmailZapAuditReport {
  gmailTriggerRows: number;
  zaps: GmailZapAuditEntry[];
  counts: {
    totalZaps: number;
    activeZaps: number;
    solana: number;
    gmailActions: number;
    currentlyFailing: number;
    legacyTemplates: number;
  };
}

const LEGACY_TEMPLATE = /\{\{[A-Za-z0-9_]+\}\}/;

/** Catalog action types (seeded names + legacy/inline variants) that are
 * Gmail actions the worker cannot execute. */
export function isGmailActionType(type: string): boolean {
  return type.startsWith('Gmail');
}

/** Action types that throw `Unsupported action type` on today's Gmail path. */
export function isCurrentlyFailingOnGmailPath(type: string): boolean {
  return type === 'Webhook' || type.startsWith('WhatsApp') || type.startsWith('Telegram');
}

function metadataHasLegacyTemplates(value: unknown): boolean {
  if (typeof value === 'string') return LEGACY_TEMPLATE.test(value);
  if (Array.isArray(value)) return value.some(metadataHasLegacyTemplates);
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(metadataHasLegacyTemplates);
  }
  return false;
}

/** Pure classification over already-fetched rows (unit-testable, no DB). */
export function buildAuditReport(gmailTriggerRows: any[]): GmailZapAuditReport {
  const byZapId = new Map<string, GmailZapAuditEntry>();

  for (const row of gmailTriggerRows) {
    const zap = row.zap;
    if (!zap?.id) continue;

    let entry = byZapId.get(zap.id);
    if (!entry) {
      const actions = [...(zap.actions || [])].sort(
        (a, b) => (a.sortingOrder ?? 0) - (b.sortingOrder ?? 0)
      );
      const actionTypes = actions.map((a) => a.action?.type).filter(Boolean) as string[];

      entry = {
        zapId: zap.id,
        zapName: zap.name ?? 'Untitled',
        userId: zap.userId,
        isActive: Boolean(zap.isActive),
        triggerTypes: [],
        actionTypes,
        hasSolana: actionTypes.includes('Solana'),
        hasGmailAction: actionTypes.some(isGmailActionType),
        hasCurrentlyFailingAction: actionTypes.some(isCurrentlyFailingOnGmailPath),
        hasLegacyTemplates: actions.some((a) => metadataHasLegacyTemplates(a.metadata)),
      };
      byZapId.set(zap.id, entry);
    }

    if (row.triggerType && !entry.triggerTypes.includes(row.triggerType)) {
      entry.triggerTypes.push(row.triggerType);
    }
  }

  const zaps = [...byZapId.values()];
  return {
    gmailTriggerRows: gmailTriggerRows.length,
    zaps,
    counts: {
      totalZaps: zaps.length,
      activeZaps: zaps.filter((z) => z.isActive).length,
      solana: zaps.filter((z) => z.hasSolana).length,
      gmailActions: zaps.filter((z) => z.hasGmailAction).length,
      currentlyFailing: zaps.filter((z) => z.hasCurrentlyFailingAction).length,
      legacyTemplates: zaps.filter((z) => z.hasLegacyTemplates).length,
    },
  };
}

/** Fetch + build. Accepts the db client structurally so tests can prove
 * read-only behavior with a findMany-only fake. */
export async function auditGmailZaps(
  db: { gmailTrigger: { findMany: (args: any) => Promise<any[]> } } = client as any
): Promise<GmailZapAuditReport> {
  const rows = await db.gmailTrigger.findMany({
    include: {
      zap: {
        include: {
          actions: { include: { action: true } },
        },
      },
    },
  });
  return buildAuditReport(rows);
}

/**
 * The D7 deactivation set: ACTIVE Zaps whose behavior changes dangerously
 * at the P4 flip — Solana becomes a real transfer, Gmail* catalog actions
 * become (loud) worker failures. Inactive Zaps are excluded: they cannot
 * fire, and re-enabling one is already a conscious owner action.
 */
export function riskyZapIds(report: GmailZapAuditReport): string[] {
  return report.zaps
    .filter((z) => z.isActive && (z.hasSolana || z.hasGmailAction))
    .map((z) => z.zapId);
}

/**
 * Deactivate the risky set (the ONLY write this script performs, behind
 * --apply-deactivate-risky). Mirrors the seed.ts warn-and-deactivate
 * precedent. Returns the ids that were flipped.
 */
export async function applyDeactivateRisky(
  db: { zap: { updateMany: (args: any) => Promise<{ count: number }> } },
  report: GmailZapAuditReport
): Promise<{ deactivatedIds: string[]; count: number }> {
  const ids = riskyZapIds(report);
  if (ids.length === 0) return { deactivatedIds: [], count: 0 };

  const result = await db.zap.updateMany({
    where: { id: { in: ids }, isActive: true },
    data: { isActive: false },
  });
  return { deactivatedIds: ids, count: result.count };
}

export function formatAuditReport(report: GmailZapAuditReport): string {
  const lines: string[] = [];
  const flags = (z: GmailZapAuditEntry) =>
    [
      z.hasSolana ? 'SOLANA(fake->real!)' : null,
      z.hasGmailAction ? 'GmailAction(worker-unsupported)' : null,
      z.hasCurrentlyFailingAction ? 'currently-failing(will-start-working)' : null,
      z.hasLegacyTemplates ? '{{legacy-templates}}' : null,
    ]
      .filter(Boolean)
      .join(', ') || 'clean';

  lines.push('=== Gmail-triggered Zap audit (read-only) ===');
  lines.push(`GmailTrigger rows: ${report.gmailTriggerRows}`);
  lines.push(
    `Zaps: ${report.counts.totalZaps} (${report.counts.activeZaps} active) | ` +
      `Solana: ${report.counts.solana} | Gmail actions: ${report.counts.gmailActions} | ` +
      `currently-failing actions: ${report.counts.currentlyFailing} | ` +
      `legacy {{}} templates: ${report.counts.legacyTemplates}`
  );
  lines.push('');
  for (const z of report.zaps) {
    lines.push(
      `- ${z.isActive ? 'ACTIVE ' : 'inactive'} Zap "${z.zapName}" (${z.zapId}) owner=${z.userId} ` +
        `triggers=[${z.triggerTypes.join(',') || '?'}] actions=[${z.actionTypes.join(' -> ')}] flags: ${flags(z)}`
    );
  }
  if (report.zaps.length === 0) lines.push('(no Gmail-triggered Zaps found)');
  lines.push('');
  lines.push(
    'Next (spec P4): deactivate SOLANA + GmailAction sets, review the ' +
      'currently-failing set (Q3), dry-run the {{}}->{ } rewrite (D8).'
  );
  return lines.join('\n');
}

if (require.main === module) {
  const applyDeactivate = process.argv.includes('--apply-deactivate-risky');

  auditGmailZaps()
    .then(async (report) => {
      console.log(formatAuditReport(report));

      const risky = riskyZapIds(report);
      if (applyDeactivate) {
        const { deactivatedIds, count } = await applyDeactivateRisky(client as any, report);
        console.log(
          `\n--apply-deactivate-risky: deactivated ${count} Zap(s): ${deactivatedIds.join(', ') || '(none)'}`
        );
        console.log('Owners must consciously re-enable these after reviewing them (spec D7).');
      } else if (risky.length > 0) {
        console.log(
          `\n${risky.length} active risky Zap(s) would be deactivated by --apply-deactivate-risky (dry-run — nothing written).`
        );
      }
    })
    .catch((error) => {
      console.error('Gmail zap audit failed:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await client.$disconnect();
    });
}
