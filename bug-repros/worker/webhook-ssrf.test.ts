/**
 * BUG: the Webhook action performs no egress validation. `sendWebhook`
 * (apps/worker/src/sendWebhook.ts:23-31) only checks that `new URL(url)` parses,
 * then fetches it and stores the response body in the run output, which the
 * dashboard renders. A Zap author (or anyone who can edit a Zap's action
 * metadata) can therefore point a Webhook step at
 * `http://169.254.169.254/latest/meta-data/…` (cloud metadata / IAM credentials),
 * `http://127.0.0.1:5432`, `http://localhost:3000/admin` or any internal RFC1918
 * host and read the response back through the ZapRun — a classic read-SSRF.
 *
 * The repo already implements the needed controls for AI connections
 * (packages/ai-connections/src/policy.ts: `normalizeBaseUrl` + `isPublicAddress`);
 * the Webhook action just does not use them.
 *
 * Expected (green): private/loopback/link-local hosts and non-http(s) schemes
 * are refused before any request is made.
 */
import { sendWebhook } from '../../apps/worker/src/sendWebhook';

const fetchMock = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (global as any).fetch = fetchMock;
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => 'application/json' },
    json: async () => ({ leaked: 'credentials' }),
    text: async () => 'leaked',
  });
});

describe('sendWebhook egress policy', () => {
  const blockedTargets = [
    'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://127.0.0.1:5432/',
    'http://localhost:3000/admin',
    'http://[::1]:8080/secret',
    'http://10.0.0.5/internal',
    'http://192.168.1.1/router',
    'http://172.16.0.9/db',
    'file:///etc/passwd',
  ];

  it.each(blockedTargets)('refuses to fetch %s', async (url) => {
    const result = await sendWebhook({ url, method: 'GET' as const });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/blocked|private|not allowed|denied|invalid/i);
  });

  it('allows a normal public https endpoint (control)', async () => {
    const result = await sendWebhook({
      url: 'https://hooks.example.com/inbound',
      method: 'POST' as const,
      body: { hello: 'world' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
  });
});
