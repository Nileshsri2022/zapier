/**
 * Does choosing this trigger/action open the step-3 configuration form?
 *
 * This used to be an inline boolean inside `Modal.tsx`, and it drifted from the
 * forms that step 3 actually renders:
 *
 * - `Webhook` and `GitHub` had trigger forms in step 3 but were missing here,
 *   so the forms were unreachable and the trigger was saved with
 *   `metadata: {}` — no signing secret, no GitHub webhook URL (#43).
 * - `WhatsApp` *actions* collect recipient/template in step 3 but were missing
 *   here, so they were saved with `{ serverId }` only and every run failed in
 *   the worker (#42).
 *
 * Keeping the rule as a pure function makes it testable without rendering the
 * whole modal: `apps/web/tests/step3-gate.test.cjs`.
 *
 * @param type      the catalog type, e.g. `'Webhook'`, `'Gmail New Email'`
 * @param stage     `1` for the trigger modal, `>1` for an action modal
 */
export function needsMetadataStep(type: string | null | undefined, stage: number): boolean {
  if (!type) return false;
  const isAction = stage > 1;

  // Trigger-only forms: incoming catch hook, GitHub repo hooks, schedules, and
  // the IM triggers whose chat filter lives in step 3.
  if (type === 'Webhook') return true;
  if (type.startsWith('GitHub')) return true;
  if (type.startsWith('Schedule')) return true;

  // Gmail, Sheets, Calendar render a form for triggers and actions alike.
  if (type.includes('Gmail')) return true;
  if (type.includes('Google Sheets')) return true;
  if (type.includes('Google Calendar')) return true;

  if (type === 'Email' || type === 'Solana' || type === 'AI Transform') return true;
  if (type === 'Discord Send Message') return true;

  // Telegram has a trigger form (chat-type filter) and an action form
  // (text/photo/document). WhatsApp only has an action form: its trigger
  // picks the connected server in the account step.
  if (type.startsWith('Telegram')) return true;
  return isAction && type.startsWith('WhatsApp');
}
