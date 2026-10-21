import { acceptedActionTypes, findAction, type ActionEntry, type ExecutorKey } from '@repo/actions';
import { resolvePlaceholders } from '@repo/placeholders';
import { actionShouldRetry, withRetry, type RetryConfig, type RetryResult } from './utils/retry';
import { EmailActionError } from './sendEmail';
import { resolveDiscordPlaceholders, sendDiscordMessage } from './sendDiscord';
import type { AiActionContext } from './executeAiAction';

/**
 * The action executor registry — "which actions can this worker run?".
 *
 * Previously the answer was an if-cascade in `index.ts` plus a separate
 * `KNOWN_ACTION_TYPES` list that had to agree with it (and did not: the three
 * branches before the guard were invisible to the list). Both are now one table
 * keyed by the catalog's `executorKey`, annotated `Record<ExecutorKey, …>` so a
 * missing executor is a type error rather than a production fallthrough.
 */

export interface ActionOutput {
  success: boolean;
  message: string;
  output?: any;
}

export type RetryPolicyName = 'none' | 'action' | 'email';

/**
 * `withRetry` counts *attempts*, not retries: `maxRetries: 1` means one try.
 * Naming here follows the policy, the numbers follow the helper.
 */
export const RETRY_POLICIES: Record<RetryPolicyName, Partial<RetryConfig>> = {
  /**
   * Webhooks never retry. The receiver may already have processed the request
   * — an accepted-but-timed-out POST is indistinguishable from a lost one — so
   * idempotency is the receiver's responsibility, not ours (A4). Do not
   * "helpfully" switch this to the default policy.
   */
  none: { maxRetries: 1, shouldRetry: () => false },
  /** Default: transient provider failures retry, classified errors decide. */
  action: { maxRetries: 3, shouldRetry: actionShouldRetry },
  /** Email: validation/auth/quota/attachment failures fail fast. */
  email: {
    maxRetries: 3,
    shouldRetry: (error) => error instanceof EmailActionError && error.retryable,
  },
};

export interface ActionRunContext {
  metadata: any;
  zapRunMetadata: any;
  previousOutputs?: Record<number, any>;
  context?: AiActionContext;
}

export interface ActionExecutor {
  /**
   * The policy the dispatcher applies, or omitted when the executor owns its
   * retries and returns its own `RetryResult` (AI Transform, whose step loop has
   * its own budget). Wrapping that one would multiply the retry counts.
   */
  policy?: RetryPolicyName;
  /** One attempt: return the output, or throw. The dispatcher wraps it. */
  run(runContext: ActionRunContext): Promise<ActionOutput | RetryResult<ActionOutput>>;
}

// Heavy provider SDKs (@solana/web3.js, googleapis reachable through the AI and
// webhook modules) stay behind dynamic imports so a Zap that never uses them
// does not pay for them at startup.
const EXECUTOR_IMPLEMENTATIONS = {
  ai: {
    run: async ({ metadata, zapRunMetadata, previousOutputs, context }: ActionRunContext) => {
      const { executeAiAction } = await import('./executeAiAction.js');
      return executeAiAction(metadata, zapRunMetadata, previousOutputs, context);
    },
  },

  // A2: Email sends via the Gmail API (shared Google connection). Validation,
  // auth, quota and attachment failures never retry — only transient provider
  // errors do (at-least-once; a duplicate is possible after an accepted timeout).
  email: {
    policy: 'email',
    run: async ({ metadata, zapRunMetadata, context }: ActionRunContext) => {
      const { sendEmailAction } = await import('./sendEmail.js');
      const output = await sendEmailAction(
        metadata,
        { ...zapRunMetadata, userId: zapRunMetadata?.userId ?? context?.userId },
        {}
      );
      return { success: true, message: `Email sent to ${output.to}`, output };
    },
  },

  solana: {
    policy: 'action',
    run: async ({ metadata, zapRunMetadata }: ActionRunContext) => {
      // A3: read-only v1 — no keys, no signing, no transfers.
      const { runSolanaAction } = await import('./solanaRead.js');
      const resolved = {
        ...metadata,
        address: metadata?.address
          ? String(resolvePlaceholders(String(metadata.address), zapRunMetadata))
          : undefined,
        owner: metadata?.owner
          ? String(resolvePlaceholders(String(metadata.owner), zapRunMetadata))
          : undefined,
        mint: metadata?.mint
          ? String(resolvePlaceholders(String(metadata.mint), zapRunMetadata))
          : undefined,
      };
      const output = await runSolanaAction(resolved);
      console.log(`✅ Solana ${output.operation} on ${output.network}`);
      return { success: true, message: `Solana ${output.operation} on ${output.network}`, output };
    },
  },

  whatsapp: {
    policy: 'action',
    run: async ({ metadata, zapRunMetadata, context }: ActionRunContext) => {
      // A5: shared Meta connection, template/freeform kinds, strict phone
      // validation. Credentials never come from step metadata.
      const { sendWhatsAppAction } = await import('./sendWhatsApp.js');
      const output = await sendWhatsAppAction(
        metadata,
        { ...zapRunMetadata, userId: zapRunMetadata?.userId ?? context?.userId },
        {}
      );
      console.log(`✅ WhatsApp ${output.kind} message sent to ${output.to}`);
      return { success: true, message: `WhatsApp sent to ${output.to}`, output };
    },
  },

  telegram: {
    policy: 'action',
    run: async ({ metadata, zapRunMetadata, context }: ActionRunContext) => {
      // A6: bot token comes from the shared TelegramBot connection; supports
      // text, photo/document, parse modes and the full option set.
      const { sendTelegramAction } = await import('./sendTelegram.js');
      const output = await sendTelegramAction(
        metadata,
        { ...zapRunMetadata, userId: zapRunMetadata?.userId ?? context?.userId },
        {}
      );
      console.log(`✅ Telegram message sent to chat ${output.chat.id}`);
      return { success: true, message: `Telegram sent to chat ${output.chat.id}`, output };
    },
  },

  discord: {
    policy: 'action',
    run: async ({ metadata, zapRunMetadata }: ActionRunContext) => {
      const { webhookUrl, content, username, avatarUrl, embed } = metadata;

      const resolvedOptions = resolveDiscordPlaceholders(
        {
          content: content || undefined,
          username: username || undefined,
          avatarUrl: avatarUrl || undefined,
          embed,
        },
        zapRunMetadata
      );

      const result = await sendDiscordMessage(webhookUrl || '', resolvedOptions);

      if (!result.success) {
        const error = new Error(`Discord send failed: ${result.error}`);
        (error as any).isFatal = result.isFatal;
        throw error;
      }

      console.log(`✅ Discord message sent via webhook`);
      return {
        success: true,
        message: `Discord message delivered`,
        output: {
          messageId: result.messageId,
          timestamp: result.timestamp || new Date().toISOString(),
        },
      };
    },
  },

  webhook: {
    policy: 'none',
    run: async ({ metadata, zapRunMetadata }: ActionRunContext) => {
      // A4: idempotent-only retries are implemented inside runWebhookAction, so
      // the generic wrapper runs it exactly once (no 3x duplicate side effects).
      const { runWebhookAction } = await import('./sendWebhook.js');
      const output = await runWebhookAction(metadata, zapRunMetadata);
      return { success: true, message: `Webhook ${output.status} from ${output.url}`, output };
    },
  },
} satisfies Record<ExecutorKey, ActionExecutor>;

/**
 * The table the dispatcher reads. Annotated (not inferred) so a missing
 * `ExecutorKey` is a compile error; `satisfies` above already proves the
 * literal is complete, and this export gives dispatch a uniform shape.
 */
export const EXECUTORS: Record<ExecutorKey, ActionExecutor> = EXECUTOR_IMPLEMENTATIONS;

export interface ResolvedAction {
  entry: ActionEntry;
  executor: ActionExecutor;
}

/** Exact type → catalog entry + executor. Unknown types have no fallback. */
export function resolveAction(actionType: string): ResolvedAction | undefined {
  const entry = findAction(actionType);
  if (!entry) return undefined;

  const executor = EXECUTORS[entry.executorKey];
  // Unreachable while the catalog and ExecutorKey agree; a runtime backstop for
  // a catalog entry shipped ahead of its executor.
  if (!executor) return undefined;

  return { entry, executor };
}

/**
 * Unknown-type failure, listing what the worker does implement: the catalogue
 * is the source of truth for the message, so it cannot go stale.
 */
export function unknownActionError(actionType: string): Error {
  return new Error(
    `Unknown action type: "${actionType}". The worker does not implement this action; ` +
      `check the Zap's steps against the available action catalog. ` +
      `Known types: ${acceptedActionTypes().join(', ')}.`
  );
}

/**
 * Execute one step with its action's retry policy.
 *
 * The lookup happens *before* any retry: an unknown type will not become known
 * between attempts, so it fails once immediately instead of burning three
 * attempts and two backoff sleeps.
 */
export async function executeActionWithRetry(
  actionType: string,
  metadata: any,
  zapRunMetadata: any,
  previousOutputs?: Record<number, any>,
  context?: AiActionContext
): Promise<RetryResult<ActionOutput>> {
  const resolved = resolveAction(actionType);
  if (!resolved) {
    return { success: false, error: unknownActionError(actionType), attempts: 0, totalTimeMs: 0 };
  }

  const { executor } = resolved;
  const attempt = () => executor.run({ metadata, zapRunMetadata, previousOutputs, context });

  if (!executor.policy) {
    // The executor owns its retries and returns its own RetryResult.
    return (await attempt()) as RetryResult<ActionOutput>;
  }

  return withRetry(async () => (await attempt()) as ActionOutput, RETRY_POLICIES[executor.policy]);
}
