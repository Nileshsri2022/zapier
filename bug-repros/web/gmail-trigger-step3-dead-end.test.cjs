/**
 * BUG: the Gmail trigger configuration step is a dead end — the trigger can
 * never be added to the Zap.
 *
 * `handleContinue` treats Gmail as needing a metadata form
 * (apps/web/components/Modal.tsx:208-215) and moves to step 3, but the trigger
 * branch of `renderStep3` (Modal.tsx:567-593) has cases for Webhook, Google
 * Sheets, Google Calendar, Schedule and GitHub only. A Gmail trigger therefore
 * falls through to:
 *
 *   <div className="modal-notice">No configuration needed</div>
 *
 * with no form and no Save button, so `handleSaveMetaData` → `onClick(...)` is
 * never called and the editor never receives the selected trigger. The only ways
 * out are "Back to event selection" or closing the modal. (GmailMetaData exists
 * and IS wired for Gmail *actions* at Modal.tsx:625-626, just not for triggers.)
 *
 * This repro works around the separate "gmailServers key" bug by returning both
 * `gmailServers` and `servers`, so the account can be selected and step 3 is
 * reachable.
 *
 * Expected (green): step 3 renders a Gmail trigger form (labels/sender/folder as
 * relevant) whose Save hands the trigger + metadata back to the editor.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderModal } = require('./harness.cjs');

test('a Gmail trigger can be configured and saved from step 3', async (t) => {
  const m = await renderModal({
    isVisible: 1,
    triggers: [{ id: 'gmail-new-email', type: 'Gmail New Email', image: '/apps/gmail.svg' }],
    endpoints: {
      '/api/gmail/servers': {
        gmailServers: [{ id: 'gmail-server-1', email: 'ada@gmail.com' }],
        // Workaround for the `gmailServers` vs `servers` key mismatch so this
        // probe isolates the step-3 dead end.
        servers: [{ id: 'gmail-server-1', email: 'ada@gmail.com' }],
      },
    },
  });
  t.after(m.unmount);

  await m.clickApp('Gmail');
  await m.chooseEvent('Gmail New Email');
  await m.click(m.buttonByText('Continue'));

  // Step 3 must offer a form that can save the trigger.
  assert.deepEqual(
    m.forms(),
    ['GmailMetaData'],
    `expected the Gmail trigger form in step 3, found ${JSON.stringify(
      m.forms()
    )} and notices ${JSON.stringify(m.notices())}`
  );

  const save = m.buttonByClass('save-GmailMetaData');
  assert.ok(save, 'expected a Save control in the Gmail trigger form');
  await m.click(save);

  assert.equal(m.results.length, 1, 'the editor must receive the selected Gmail trigger');
  assert.equal(m.results[0].type, 'Gmail New Email');
});
