/**
 * BUG: the WhatsApp trigger ingress is unauthenticated.
 *
 * 1. `handleWhatsAppWebhook` (apps/hooks/src/whatsappHandler.ts:30-71) never
 *    checks Meta's `X-Hub-Signature-256` header — it trusts `req.body` as-is.
 *    Anyone who knows (or guesses) the public webhook URL can POST a forged
 *    `whatsapp_business_account` payload and fire every tenant's WhatsApp
 *    trigger: the forged `metadata.phoneNumberId` selects the victim triggers,
 *    and the forged `from`/`text` flow into the Zap's actions (an Email or
 *    WhatsApp send step becomes an arbitrary-content relay).
 * 2. `verifyWhatsAppWebhook` (line 5) falls back to a hardcoded verify token
 *    `WHATSAPP_VERIFY_TOKEN || 'zapmate_whatsapp_verify'`, so an attacker can
 *    complete Meta's endpoint-verification handshake with the value that is
 *    committed to the repo.
 *
 * Expected (green): with an app secret configured, an unsigned or wrongly
 * signed delivery is rejected and enqueues nothing; with no verify token
 * configured, endpoint verification fails closed.
 */
const mockFindMany = jest.fn();
const mockZapFindFirst = jest.fn();
const mockTriggerUpdate = jest.fn();
const mockEnqueueRun = jest.fn();

jest.mock('@repo/db', () => ({
  __esModule: true,
  default: {
    whatsAppTrigger: {
      findMany: (...args: any[]) => mockFindMany(...args),
      update: (...args: any[]) => mockTriggerUpdate(...args),
    },
    zap: { findFirst: (...args: any[]) => mockZapFindFirst(...args) },
  },
}));

jest.mock('@repo/runs', () => ({
  enqueueRun: (...args: any[]) => mockEnqueueRun(...args),
}));

const APP_SECRET = 'whatsapp-app-secret-for-repro';

// Imported lazily so the module-level env reads see the values set here.
const loadHandler = () => {
  jest.resetModules();
  process.env.WHATSAPP_APP_SECRET = APP_SECRET;
  process.env.WHATSAPP_WEBHOOK_SECRET = APP_SECRET;
  return require('../../apps/hooks/src/whatsappHandler') as typeof import('../../apps/hooks/src/whatsappHandler');
};

const forgedBody = {
  object: 'whatsapp_business_account',
  entry: [
    {
      changes: [
        {
          value: {
            metadata: { phone_number_id: 'victim-phone-number-id' },
            contacts: [{ profile: { name: 'Attacker' } }],
            messages: [
              {
                id: 'wamid.FORGED1',
                from: '919999999999',
                timestamp: '1700000000',
                type: 'text',
                text: { body: 'Pay the ransom' },
              },
            ],
          },
        },
      ],
    },
  ],
};

const hmacFor = (raw: string) =>
  `sha256=${require('crypto').createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`;

const post = async (headers: Record<string, string>, body: any) => {
  const { handleWhatsAppWebhook } = loadHandler();
  const sendStatus = jest.fn();
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { sendStatus, status, json } as any;

  await handleWhatsAppWebhook({ headers, body } as any, res);
  // processWhatsAppMessage runs detached; let its promise settle.
  await new Promise((r) => setTimeout(r, 20));
  return { sendStatus, status, json };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockFindMany.mockResolvedValue([
    { id: 'wt-1', zapId: 'zap-victim', server: { phoneNumberId: 'victim-phone-number-id' } },
  ]);
  mockZapFindFirst.mockResolvedValue({ id: 'zap-victim', name: 'Victim Zap' });
  mockTriggerUpdate.mockResolvedValue({});
  mockEnqueueRun.mockResolvedValue({ status: 'queued', zapRunId: 'run-1' });
});

describe('WhatsApp ingress authentication', () => {
  it('rejects a delivery with no X-Hub-Signature-256 header', async () => {
    const { sendStatus, status } = await post({}, forgedBody);

    expect(mockEnqueueRun).not.toHaveBeenCalled();
    const code = status.mock.calls[0]?.[0] ?? sendStatus.mock.calls[0]?.[0];
    expect(code).toBe(401);
  });

  it('rejects a delivery signed with the wrong secret', async () => {
    const raw = JSON.stringify(forgedBody);
    const { sendStatus, status } = await post(
      { 'x-hub-signature-256': hmacFor(raw).replace(/.$/, '0') },
      forgedBody
    );

    expect(mockEnqueueRun).not.toHaveBeenCalled();
    const code = status.mock.calls[0]?.[0] ?? sendStatus.mock.calls[0]?.[0];
    expect(code).toBe(401);
  });

  it('fails closed on endpoint verification when no verify token is configured', async () => {
    jest.resetModules();
    delete process.env.WHATSAPP_VERIFY_TOKEN;
    const { verifyWhatsAppWebhook } = require('../../apps/hooks/src/whatsappHandler');

    const send = jest.fn();
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json, send });
    const res = { status, json, send } as any;

    await verifyWhatsAppWebhook(
      {
        query: {
          'hub.mode': 'subscribe',
          // The hardcoded fallback committed in whatsappHandler.ts:5
          'hub.verify_token': 'zapmate_whatsapp_verify',
          'hub.challenge': '1234',
        },
      } as any,
      res
    );

    expect(status).toHaveBeenCalledWith(403);
    expect(send).not.toHaveBeenCalled();
  });
});
