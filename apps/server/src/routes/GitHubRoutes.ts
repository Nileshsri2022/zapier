import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import client from '@repo/db';
import { enqueueRun } from '@repo/runs';
import { verifyGithub } from '@repo/ingress';

/**
 * GitHub webhook ingress — T4 spec (docs/ask-matt/triggers/github.md, round 6).
 *
 * - Contract §4: qualified event ("issues.opened", "pull_request.opened",
 *   "push"), trimmed slices (repository/sender/issue/pull_request/push),
 *   deliveryId + raw passthrough always present.
 * - Dedupe §5: X-GitHub-Delivery keyed (delivery-id set), one run per push
 *   with commits[] bundled, list capped at 20 while commitCount is the true
 *   total.
 * - Optional branch/tag filter evaluated on ref — no default restriction
 *   (Q-GH-05: everything fires until the builder filters).
 * - Signature: env GITHUB_WEBHOOK_SECRET enforced fail-closed when set;
 *   per-zap secret saved by the config UI (Trigger.metadata.webhookSecret)
 *   is also verified; only fully unconfigured (dev) deliveries run unsigned.
 * - Legacy beyond-spec: `GitHub Release` mapping + release slice kept, all
 *   pre-existing payload aliases kept (repository.name/full_name/url,
 *   sender.url, action, head_commit, top-level branch/ref/commits).
 * - Polling fallback (REST cursor): consciously deferred — this app has no
 *   GitHub connection model to authenticate a poller with; delivery path
 *   here is the manually-registered repo webhook. Logged in grill log T4.
 */

const router = Router();

/** Spec §5: commits[] bundled per push, list capped at 20. */
export const PUSH_COMMIT_CAP = 20;

// Parse GitHub event type to trigger type
function getGitHubTriggerType(event: string): string | null {
  const eventMap: Record<string, string> = {
    push: 'GitHub Push',
    pull_request: 'GitHub Pull Request',
    issues: 'GitHub Issue',
    release: 'GitHub Release',
  };
  return eventMap[event] || null;
}

/** Branch/tag filter evaluated on ref — absent/empty = no restriction. */
export function matchesRefFilter(
  ref: string,
  metadata: { branchFilter?: unknown; tagFilter?: unknown } | null | undefined
): boolean {
  const refName = String(ref || '').replace(/^refs\/heads\//, '').replace(/^refs\/tags\//, '');
  const asList = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.map(String);
    if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean);
    return [];
  };
  const branches = asList(metadata?.branchFilter);
  const tags = asList(metadata?.tagFilter);
  const isTag = String(ref || '').startsWith('refs/tags/');
  if (isTag) {
    return tags.length === 0 || tags.includes(refName);
  }
  return branches.length === 0 || branches.includes(refName);
}

/**
 * Spec §4 contract builder — trimmed normalized slices + raw passthrough.
 * Legacy aliases are supersets of the old payload so existing templates
 * keep mapping.
 */
export function buildGithubRunPayload(
  event: string,
  payload: any,
  deliveryId: string
): Record<string, any> {
  const action = typeof payload?.action === 'string' ? payload.action : undefined;
  const data: Record<string, any> = {
    event: action ? `${event}.${action}` : event,
    repository: {
      fullName: payload?.repository?.full_name || '',
      htmlUrl: payload?.repository?.html_url || '',
      private: Boolean(payload?.repository?.private),
      defaultBranch: payload?.repository?.default_branch || null,
      // legacy aliases
      name: payload?.repository?.name || '',
      full_name: payload?.repository?.full_name || '',
      url: payload?.repository?.html_url || '',
    },
    sender: {
      login: payload?.sender?.login || '',
      id: payload?.sender?.id ?? null,
      avatarUrl: payload?.sender?.avatar_url || null,
      // legacy alias
      url: payload?.sender?.html_url || '',
    },
    deliveryId,
    raw: payload,
    // legacy aliases kept at top level
    ...(action ? { action } : {}),
  };

  switch (event) {
    case 'issues': {
      const issue = payload?.issue;
      data.issue = {
        number: issue?.number ?? 0,
        title: issue?.title || '',
        body: issue?.body || '',
        state: issue?.state || '',
        labels: (issue?.labels || []).map((l: any) => (typeof l === 'string' ? l : l?.name)).filter(Boolean),
        htmlUrl: issue?.html_url || '',
        // legacy aliases
        url: issue?.html_url || '',
        user: issue?.user?.login || '',
      };
      break;
    }
    case 'pull_request': {
      const pr = payload?.pull_request;
      data.pull_request = {
        number: pr?.number ?? 0,
        title: pr?.title || '',
        state: pr?.state || '',
        draft: Boolean(pr?.draft),
        base: pr?.base?.ref || '',
        head: pr?.head?.ref || '',
        merged: Boolean(pr?.merged),
        htmlUrl: pr?.html_url || '',
        // legacy aliases
        url: pr?.html_url || '',
        body: pr?.body || '',
        user: pr?.user?.login || '',
      };
      break;
    }
    case 'push': {
      const commits = Array.isArray(payload?.commits) ? payload.commits : [];
      // GitHub's push payload carries `size` = true number of commits in the
      // push even when the commits array is capped/truncated by GitHub itself.
      const commitCount = typeof payload?.size === 'number' ? payload.size : commits.length;
      data.push = {
        ref: payload?.ref || '',
        before: payload?.before || '',
        after: payload?.after || '',
        commits: commits.slice(0, PUSH_COMMIT_CAP).map((c: any) => ({
          id: c?.id || '',
          message: c?.message || '',
          author: { name: c?.author?.name || '', email: c?.author?.email || '' },
          url: c?.url || '',
        })),
        commitCount,
        headCommitMessage: payload?.head_commit?.message || '',
        branch: String(payload?.ref || '').replace(/^refs\/heads\//, ''),
      };
      // legacy aliases (old payload shape)
      data.ref = payload?.ref || '';
      data.branch = data.push.branch;
      data.commits = commits.length;
      data.head_commit = {
        message: payload?.head_commit?.message || '',
        author: payload?.head_commit?.author?.name || '',
        url: payload?.head_commit?.url || '',
      };
      data.pusher = {
        name: payload?.pusher?.name || '',
        email: payload?.pusher?.email || '',
      };
      break;
    }
    case 'release': {
      // beyond-spec legacy event (E4 backlog) — kept working as-is
      data.release = {
        tag_name: payload?.release?.tag_name || '',
        name: payload?.release?.name || '',
        body: payload?.release?.body || '',
        url: payload?.release?.html_url || '',
        prerelease: Boolean(payload?.release?.prerelease),
      };
      break;
    }
    default:
      break;
  }

  return data;
}

// Handle GitHub webhook
router.post('/webhook/:zapId', async (req: Request, res: Response): Promise<any> => {
  try {
    const zapId = req.params.zapId as string;
    const eventHeader = req.headers['x-github-event'];
    const event: string = Array.isArray(eventHeader) ? (eventHeader[0] ?? '') : (eventHeader ?? '');
    const sigHeader = req.headers['x-hub-signature-256'];
    const signature: string | undefined = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
    const deliveryHeader = req.headers['x-github-delivery'];
    const deliveryId =
      (Array.isArray(deliveryHeader) ? deliveryHeader[0] : deliveryHeader) || '';
    const envSecret = process.env.GITHUB_WEBHOOK_SECRET;

    console.log(`📦 GitHub webhook received: ${event} for zap ${zapId}`);

    // Validate event type
    const triggerType = getGitHubTriggerType(event);
    if (!triggerType) {
      console.log(`⚠️ Unsupported GitHub event: ${event}`);
      return res.status(200).json({ message: 'Event type not supported', event });
    }

    const rawBody = (req as any).rawBody?.toString('utf8') ?? JSON.stringify(req.body);

    // Signature policy is owned by @repo/ingress: fail-closed once either the
    // env or per-Zap secret is configured. (GitHub's spec is the one audited
    // `allowOpenWhenUnconfigured` entry on the server side — see ADR-0002.)
    const signatureVerdict = verifyGithub(
      { headers: { 'x-hub-signature-256': signature }, rawBody },
      envSecret
    );
    if (!signatureVerdict.ok) {
      console.log(`❌ GitHub ${signatureVerdict.code} for zap ${zapId}`);
      return res.status(signatureVerdict.status).json({ error: signatureVerdict.message });
    }

    // Find the zap
    const zap = await client.zap.findUnique({
      where: { id: zapId },
    });

    if (!zap) {
      return res.status(404).json({ error: 'Zap not found' });
    }

    // Get the trigger type from the database using triggerId
    const trigger = await client.trigger.findUnique({
      where: { zapId: zap.id },
    });

    const triggerMetadata = (trigger as any)?.metadata || {};

    // Per-zap secret saved by the config UI (env secret wins when both exist).
    if (!envSecret && triggerMetadata.webhookSecret) {
      const perZapVerdict = verifyGithub(
        { headers: { 'x-hub-signature-256': signature }, rawBody },
        String(triggerMetadata.webhookSecret)
      );
      if (!perZapVerdict.ok) {
        console.log(`❌ GitHub ${perZapVerdict.code} for zap ${zapId} (per-zap secret)`);
        return res.status(perZapVerdict.status).json({ error: perZapVerdict.message });
      }
    }

    let zapTriggerType: string | null = null;
    if (trigger) {
      const availableTrigger = await client.availableTriggers.findUnique({
        where: { id: trigger.triggerId },
      });
      zapTriggerType = availableTrigger?.type || null;
    }

    // Verify trigger type matches
    if (zapTriggerType !== triggerType) {
      console.log(`⚠️ Trigger mismatch: expected ${zapTriggerType}, got ${triggerType}`);
      return res.status(200).json({
        message: 'Event type does not match zap trigger',
        expected: zapTriggerType,
        received: triggerType,
      });
    }

    // Optional branch/tag filter (Q-GH-05): absent = no restriction.
    if (event === 'push' && !matchesRefFilter(String(req.body?.ref || ''), triggerMetadata)) {
      console.log(`🚫 Push filtered by ref filter: ${req.body?.ref}`);
      return res.status(200).json({
        message: 'Push filtered by branch/tag filter',
        ref: req.body?.ref,
      });
    }

    // Spec §4 payload: trimmed slices + raw + deliveryId
    const payloadData = buildGithubRunPayload(event, req.body, deliveryId);

    // Dedupe §5: X-GitHub-Delivery keyed; fall back to a payload digest when
    // a sender omits the header (redelivery of the same body still dedupes).
    const deliveryKey =
      deliveryId ||
      `sha1:${crypto.createHash('sha1').update(rawBody).digest('hex')}`;

    const result = await enqueueRun({
      zapId: zap.id,
      metadata: payloadData,
      source: 'server.github',
      dedup: { scope: 'github', key: `${zap.id}:${deliveryKey}` },
    });

    if (result.status === 'duplicate') {
      console.log(`🔁 Duplicate GitHub delivery skipped (${deliveryKey})`);
      return res.status(200).json({ message: 'Duplicate delivery skipped', event: triggerType });
    }

    if (result.status !== 'queued') {
      // The run-intake module owns the active-Zap check.
      return res.status(200).json({ message: 'Zap is not active', event: triggerType });
    }

    console.log(`✅ ZapRun queued: ${result.zapRunId} for ${triggerType}`);

    return res.status(200).json({
      message: 'GitHub webhook processed',
      zapRunId: result.zapRunId,
      event: triggerType,
    });
  } catch (error) {
    console.error('❌ GitHub webhook error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Health check for GitHub webhooks
router.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'github-webhooks' });
});

export default router;
