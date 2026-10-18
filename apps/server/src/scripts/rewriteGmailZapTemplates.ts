import client from '@repo/db';

/**
 * D8 template rewrite for reports/gmail-worker-routing-spec.md (P4).
 *
 * The legacy server-inline Email executor resolved `{{key}}` placeholders;
 * the worker resolves `{key}` (nested paths included). Gmail-triggered
 * Zaps configured against the inline executor therefore carry `{{…}}`
 * in Action.metadata, which the worker would deliver mangled/literal.
 * This script rewrites `{{word}}` -> `{word}` inside Action.metadata
 * string values.
 *
 * DRY-RUN by default (prints zap/action ids + field paths + counts,
 * never values — metadata can contain secrets):
 *   bunx tsx src/scripts/rewriteGmailZapTemplates.ts
 *   bunx tsx src/scripts/rewriteGmailZapTemplates.ts --apply
 *   bunx tsx src/scripts/rewriteGmailZapTemplates.ts --apply --scope=all
 *
 * Scope: `gmail` (default) = Zaps reachable from a GmailTrigger row.
 * `all` additionally covers Zaps only ever called through the legacy
 * server webhook route (POST /api/triggers/webhook/:zapId), which fed
 * the same inline executor until P5 — run with --scope=all before
 * deploying P5. Idempotent: single-brace templates never re-match.
 */

const LEGACY_TEMPLATE = /\{\{(\w+)\}\}/g;

export function rewriteTemplateString(input: string): string {
  return input.replace(LEGACY_TEMPLATE, '{$1}');
}

export interface MetadataRewriteResult {
  value: unknown;
  changed: boolean;
  /** JSON paths whose string values changed, e.g. "body", "nested.list[0]". */
  paths: string[];
  replacements: number;
}

/** Pure recursive rewrite over a metadata JSON value (unit-testable). */
export function rewriteMetadataTemplates(value: unknown, path = ''): MetadataRewriteResult {
  if (typeof value === 'string') {
    const rewritten = rewriteTemplateString(value);
    if (rewritten === value) return { value, changed: false, paths: [], replacements: 0 };
    const replacements = (value.match(/\{\{\w+\}\}/g) || []).length;
    return { value: rewritten, changed: true, paths: [path || '(root)'], replacements };
  }

  if (Array.isArray(value)) {
    let changed = false;
    let replacements = 0;
    const paths: string[] = [];
    const next = value.map((item, i) => {
      const result = rewriteMetadataTemplates(item, `${path}[${i}]`);
      changed = changed || result.changed;
      replacements += result.replacements;
      paths.push(...result.paths);
      return result.value;
    });
    return { value: changed ? next : value, changed, paths, replacements };
  }

  if (value && typeof value === 'object') {
    let changed = false;
    let replacements = 0;
    const paths: string[] = [];
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const result = rewriteMetadataTemplates(item, path ? `${path}.${key}` : key);
      changed = changed || result.changed;
      replacements += result.replacements;
      paths.push(...result.paths);
      next[key] = result.value;
    }
    return { value: changed ? next : value, changed, paths, replacements };
  }

  return { value, changed: false, paths: [], replacements: 0 };
}

export interface ActionRewriteEntry {
  actionDbId: string;
  zapId: string;
  actionType: string;
  paths: string[];
  replacements: number;
  nextMetadata: unknown;
}

/** Build the rewrite plan over already-fetched Zap rows (pure). */
export function buildRewritePlan(zaps: any[]): ActionRewriteEntry[] {
  const plan: ActionRewriteEntry[] = [];

  for (const zap of zaps) {
    for (const action of zap.actions || []) {
      const result = rewriteMetadataTemplates(action.metadata);
      if (!result.changed) continue;
      plan.push({
        actionDbId: action.id,
        zapId: zap.id,
        actionType: action.action?.type ?? 'unknown',
        paths: result.paths,
        replacements: result.replacements,
        nextMetadata: result.value,
      });
    }
  }

  return plan;
}

export async function fetchZapsForScope(db: any, scope: 'gmail' | 'all'): Promise<any[]> {
  if (scope === 'all') {
    return db.zap.findMany({ include: { actions: { include: { action: true } } } });
  }

  const rows = await db.gmailTrigger.findMany({
    include: { zap: { include: { actions: { include: { action: true } } } } },
  });
  const byId = new Map<string, any>();
  for (const row of rows) {
    if (row.zap?.id) byId.set(row.zap.id, row.zap);
  }
  return [...byId.values()];
}

/** Apply a plan (the only write path; behind --apply). */
export async function applyRewritePlan(
  db: { action: { update: (args: any) => Promise<any> } },
  plan: ActionRewriteEntry[]
): Promise<number> {
  let applied = 0;
  for (const entry of plan) {
    await db.action.update({
      where: { id: entry.actionDbId },
      data: { metadata: entry.nextMetadata },
    });
    applied++;
  }
  return applied;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const scopeArg = process.argv.find((a) => a.startsWith('--scope='));
  const scope: 'gmail' | 'all' = scopeArg?.endsWith('=all') ? 'all' : 'gmail';

  const zaps = await fetchZapsForScope(client as any, scope);
  const plan = buildRewritePlan(zaps);
  const totalReplacements = plan.reduce((sum, e) => sum + e.replacements, 0);

  console.log(
    `Scope=${scope}: scanned ${zaps.length} Zap(s); ${plan.length} action(s) carry ` +
      `{{legacy}} templates (${totalReplacements} replacement(s)).${apply ? '' : ' (dry-run)'}`
  );
  for (const entry of plan) {
    console.log(
      `  ${apply ? 'REWRITE' : 'WOULD REWRITE'} zap ${entry.zapId} action ${entry.actionDbId} ` +
        `(${entry.actionType}) fields: ${entry.paths.join(', ')}`
    );
  }

  if (apply) {
    const applied = await applyRewritePlan(client as any, plan);
    console.log(`Applied ${applied} action update(s).`);
  } else if (plan.length > 0) {
    console.log('Re-run with --apply to write. Values are intentionally not printed.');
  }
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error('Gmail template rewrite failed:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await client.$disconnect();
    });
}
