/**
 * Canonical registry of action types the worker can execute.
 *
 * This is the single source of truth for "can the worker run this action?".
 * The dispatcher in index.ts must reject anything not listed here instead of
 * silently no-op'ing it (see reports/workflow-execution-gaps.md, gap D2).
 *
 * When a new action type is added to the worker, add it here too — the jest
 * test in tests/actionTypes.test.ts documents the expected shapes.
 */

/** Exact action-type matches. */
export const KNOWN_ACTION_TYPES = ['Email', 'Solana', 'Webhook', 'AI Transform', 'Discord Send Message'] as const;

/** Prefix matches — e.g. 'WhatsApp Send Message', 'Telegram Send Message'. */
export const KNOWN_ACTION_PREFIXES = ['WhatsApp', 'Telegram'] as const;

export function isKnownActionType(actionType: string): boolean {
  if ((KNOWN_ACTION_TYPES as readonly string[]).includes(actionType)) {
    return true;
  }
  return KNOWN_ACTION_PREFIXES.some((prefix) => actionType.startsWith(prefix));
}
