/**
 * BUG: the Webhook and GitHub TRIGGER configuration forms are unreachable, so
 * those triggers are published with empty metadata.
 *
 * `renderStep3` (apps/web/components/Modal.tsx:567-590) has branches for both:
 *   selectedItem?.type === 'Webhook'          -> <WebhookMetaData …/>
 *   selectedItem?.type?.startsWith('GitHub')  -> <GitHubMetaData …/>
 * but the gate that decides whether step 3 is entered (Modal.tsx:208-215,
 * `needsMetadata`) lists only Google Sheets / Google Calendar / Gmail / Email /
 * Solana / AI Transform / Schedule. For a Webhook or GitHub trigger
 * `handleContinue` therefore takes the else branch (Modal.tsx:227-231) and calls
 * `onClick(itemWithAccount)` immediately — no form is ever rendered and the
 * trigger is added with `metadata: undefined`.
 *
 * Consequences:
 *  - Webhook trigger: `trigger.metadata.secret` is the only way to require a
 *    signature (apps/hooks/src/webhookAuth.ts:43-59), so a webhook Zap created
 *    in the editor can never be signature-protected; it stays a bare capability
 *    URL. The rendered form is also action-shaped (`WebhookMetaData` collects
 *    url/method/headers) rather than showing the inbound hook URL + secret.
 *  - GitHub trigger: `GitHubMetaData` collects the webhook URL/secret to register
 *    with GitHub; without it the user has nothing to paste into the repo's
 *    webhook settings.
 *
 * Expected (green): choosing a Webhook or GitHub trigger opens its configuration
 * form, and the editor receives the metadata that form produces.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderModal } = require('./harness.cjs');

async function addTrigger(t, { app, eventType }) {
  const m = await renderModal({
    isVisible: 1,
    triggers: [{ id: `${eventType}-id`, type: eventType, image: '/apps/x.svg' }],
  });
  t.after(m.unmount);

  await m.clickApp(app);
  await m.chooseEvent(eventType);
  await m.click(m.buttonByText('Continue'));

  return m;
}

test('the Webhook trigger opens its configuration form before being added', async (t) => {
  const m = await addTrigger(t, { app: 'Webhook', eventType: 'Webhook' });

  assert.deepEqual(
    m.forms(),
    ['WebhookMetaData'],
    `expected the Webhook trigger form, found ${JSON.stringify(m.forms())}`
  );
  assert.equal(
    m.results.length,
    0,
    'the trigger must not be added before its configuration is saved'
  );

  await m.click(m.buttonByClass('save-WebhookMetaData'));
  assert.equal(m.results.length, 1);
  assert.ok(
    m.results[0].metadata && Object.keys(m.results[0].metadata).length > 0,
    `expected the saved form data as trigger metadata, got ${JSON.stringify(m.results[0].metadata)}`
  );
});

test('the GitHub trigger opens its configuration form before being added', async (t) => {
  const m = await addTrigger(t, { app: 'GitHub', eventType: 'GitHub Push' });

  assert.deepEqual(
    m.forms(),
    ['GitHubMetaData'],
    `expected the GitHub trigger form, found ${JSON.stringify(m.forms())}`
  );

  await m.click(m.buttonByClass('save-GitHubMetaData'));
  assert.equal(m.results.length, 1);
  assert.ok(
    m.results[0].metadata && Object.keys(m.results[0].metadata).length > 0,
    `expected the saved form data as trigger metadata, got ${JSON.stringify(m.results[0].metadata)}`
  );
});

test('a Schedule trigger still opens its form (control)', async (t) => {
  const m = await addTrigger(t, { app: 'Schedule', eventType: 'Schedule Every Hour' });

  assert.deepEqual(m.forms(), ['ScheduleMetaData']);
});
