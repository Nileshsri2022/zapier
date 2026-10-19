/**
 * BUG: WhatsApp, Telegram and Webhook ACTIONS cannot be configured in the
 * editor, so every run of those steps fails.
 *
 * apps/web/components/Modal.tsx:208-215 decides whether step 3 (the metadata
 * form) is shown:
 *   const needsMetadata =
 *     type.includes('Google Sheets') || type.includes('Google Calendar') ||
 *     type.includes('Gmail') || type === 'Email' || type === 'Solana' ||
 *     type === 'AI Transform' || type.startsWith('Schedule');
 * 'WhatsApp Send Message', 'Telegram Send Message' and 'Webhook' are absent, so
 * `handleContinue` calls `onClick(itemWithAccount)` immediately (Modal.tsx:228)
 * with metadata that contains at most `{ serverId }` / `{ botId }`. The action
 * branch of renderStep3 (Modal.tsx:616-629) has no WhatsApp/Telegram/Webhook
 * case either, and components/metadata/ has no such form.
 *
 * The worker's contract (apps/worker/src/index.ts:147-221) requires:
 *   WhatsApp: metadata.to, metadata.message, metadata.phoneNumberId, metadata.accessToken
 *   Telegram: metadata.chatId, metadata.message, metadata.botToken
 *   Webhook:  metadata.url (method/headers/body optional)
 * None of these can ever be entered, so each of these three catalog actions
 * fails at run time (`sendWhatsAppMessage(undefined, undefined, …)`,
 * `Invalid URL`, …) and the ZapRun is marked failed.
 *
 * Expected (green): selecting one of these actions opens a form that collects
 * the fields the worker needs, and the editor receives that metadata.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderModal } = require('./harness.cjs');

async function addAction(t, { app, eventType, endpoints }) {
  const m = await renderModal({
    isVisible: 2,
    actions: [{ id: `${eventType}-id`, type: eventType, image: '/apps/x.svg' }],
    endpoints,
  });
  t.after(m.unmount);

  await m.clickApp(app);
  await m.chooseEvent(eventType);

  const continueBtn = m.buttonByText('Continue');
  if (continueBtn) await m.click(continueBtn);

  // If a form is shown, save it so the editor receives the metadata.
  const saveButtons = m.buttons().filter((b) => String(b.props.className || '').startsWith('save-'));
  for (const save of saveButtons) await m.click(save);

  return m;
}

test('WhatsApp Send Message collects the recipient, message and credentials', async (t) => {
  const m = await addAction(t, {
    app: 'WhatsApp',
    eventType: 'WhatsApp Send Message',
    endpoints: {
      '/api/whatsapp/servers': {
        servers: [{ id: 'wa-1', displayName: 'My WhatsApp', phoneNumberId: '109238475612' }],
      },
    },
  });

  assert.equal(m.results.length, 1, 'the editor must receive the WhatsApp action');
  const metadata = m.results[0].metadata || {};
  for (const field of ['to', 'message', 'phoneNumberId', 'accessToken']) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(metadata, field),
      `WhatsApp action metadata is missing "${field}"; got ${JSON.stringify(metadata)}`
    );
  }
});

test('Telegram Send Message collects the chat id, message and bot token', async (t) => {
  const m = await addAction(t, {
    app: 'Telegram',
    eventType: 'Telegram Send Message',
    endpoints: { '/api/telegram/bots': { bots: [{ id: 'bot-1', botName: 'ZapBot' }] } },
  });

  assert.equal(m.results.length, 1, 'the editor must receive the Telegram action');
  const metadata = m.results[0].metadata || {};
  for (const field of ['chatId', 'message', 'botToken']) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(metadata, field),
      `Telegram action metadata is missing "${field}"; got ${JSON.stringify(metadata)}`
    );
  }
});

test('Webhook action collects the destination URL', async (t) => {
  const m = await addAction(t, {
    app: 'Webhook',
    eventType: 'Webhook',
    endpoints: {},
  });

  assert.equal(m.results.length, 1, 'the editor must receive the Webhook action');
  const metadata = m.results[0].metadata || {};
  assert.ok(
    Object.prototype.hasOwnProperty.call(metadata, 'url'),
    `Webhook action metadata is missing "url"; got ${JSON.stringify(metadata)}`
  );
});
