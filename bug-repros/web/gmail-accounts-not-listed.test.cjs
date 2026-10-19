/**
 * BUG: the editor never lists connected Gmail accounts, so a Gmail trigger can
 * never be selected.
 *
 * `GET /api/gmail/servers` responds with `{ message, gmailServers }`
 * (apps/server/src/controllers/GmailController.ts:217-220), but the editor reads
 * a different key:
 *   const servers = response?.data?.servers || response?.data?.bots || [];
 *   (apps/web/components/Modal.tsx:124)
 * so `connectedServers` stays `[]`, no account `<select>` is rendered
 * (Modal.tsx:433), and `canContinue()` (Modal.tsx:323-330) returns false because
 * `gmail` is in `needsAccountApps` while `selectedServerId` is empty. The user is
 * stuck on "Choose an event and connect your account to continue" even though the
 * mailbox IS connected — every Gmail trigger (New Email / Labeled / Starred /
 * From Sender) is unreachable from the editor. Sheets and Calendar return
 * `{servers}` and Telegram `{bots}`, so only Gmail is affected.
 *
 * Expected (green): the connected Gmail mailbox is listed and selectable, and
 * Continue becomes available once an event is chosen.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderModal } = require('./harness.cjs');

test('a connected Gmail account is listed, selectable and allows Continue', async (t) => {
  const m = await renderModal({
    isVisible: 1,
    triggers: [
      { id: 'gmail-new-email', type: 'Gmail New Email', image: '/apps/gmail.svg' },
      { id: 'gmail-starred', type: 'Gmail Starred Email', image: '/apps/gmail.svg' },
    ],
    endpoints: {
      // Exactly what GmailController.getGmailServers returns today.
      '/api/gmail/servers': {
        message: 'Gmail servers fetched successfully',
        gmailServers: [{ id: 'gmail-server-1', email: 'ada@gmail.com' }],
      },
    },
  });
  t.after(m.unmount);

  await m.clickApp('Gmail');

  // The account picker must show the connected mailbox.
  const options = m
    .select()
    .flatMap((s) => s.children.map((c) => m.textOf(c).trim()));
  assert.ok(
    options.includes('ada@gmail.com'),
    `expected the connected Gmail account in a <select>, found options: ${JSON.stringify(options)}`
  );

  await m.chooseEvent('Gmail New Email');

  assert.ok(
    m.buttonByText('Continue'),
    `expected a Continue button after choosing an event, got notices: ${JSON.stringify(
      m.notices()
    )}`
  );
});
