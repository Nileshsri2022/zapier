/**
 * BUG: the Webhook action templates its request body by stringifying the body,
 * running the generic `{a.b}` placeholder substitution over that JSON *text*,
 * and parsing it back:
 *
 *   const resolvedBody = body ? replaceKeys(JSON.stringify(body), zapRunMetadata) : null;
 *   ... body: resolvedBody ? JSON.parse(resolvedBody) : undefined
 *   (apps/worker/src/index.ts:199, :208)
 *
 * `replaceKeys` matches `/{(.*?)}/g`, and `JSON.stringify(body)` wraps every
 * value in braces, so the pattern cannot tell a placeholder from the JSON
 * object syntax. Two failure modes:
 *
 *  1. SILENT: the first placeholder of a body is never substituted — the regex
 *     matches from the body's opening `{` to the placeholder's closing `}`
 *     (`{"text":"{value}` → unknown key `"text":"{value` → returned verbatim).
 *     The webhook is sent with the literal text `{value}`.
 *     With several keys only the later ones get substituted, so the payload is
 *     half-templated: `{"a":"{x}","b":"BBB"}`.
 *  2. HARD FAILURE: when a substituted value contains a quote, backslash or
 *     newline, the resulting text is invalid JSON and `JSON.parse` throws, so
 *     the action fails and the ZapRun is marked failed (e.g. a commit message
 *     `He said "hi"`).
 *
 * Expected (green): every placeholder in the body resolves, and substituted
 * values are JSON-escaped rather than spliced into the serialized document.
 *
 * The repro stubs `global.fetch` so the assertions are on the bytes that would
 * actually go over the wire.
 */
import { runSingleAction } from './runHarness';

const fetchMock = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (global as any).fetch = fetchMock;
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => 'application/json' },
    json: async () => ({ ok: true }),
  });
});

const webhookAction = (body: any) => ({
  type: 'Webhook',
  metadata: { url: 'https://hooks.example.com/inbound', method: 'POST', body },
});

const sentBody = () => JSON.parse(fetchMock.mock.calls[0][1].body);

describe('Webhook action body templating', () => {
  it('substitutes a placeholder in a single-key body', async () => {
    const result = await runSingleAction(webhookAction({ text: '{value}' }), {
      value: 'plain value',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentBody()).toEqual({ text: 'plain value' });
    expect(result).toEqual(expect.objectContaining({ success: true }));
  });

  it('substitutes every placeholder in a multi-key body', async () => {
    await runSingleAction(webhookAction({ a: '{x}', b: '{y}' }), { x: 'AAA', y: 'BBB' });

    expect(sentBody()).toEqual({ a: 'AAA', b: 'BBB' });
  });

  it('substitutes nested placeholders', async () => {
    await runSingleAction(webhookAction({ outer: { deep: '{commit.message}' } }), {
      commit: { message: 'Fix login flow' },
    });

    expect(sentBody()).toEqual({ outer: { deep: 'Fix login flow' } });
  });

  it('sends a body whose substituted value contains double quotes', async () => {
    const result = await runSingleAction(webhookAction({ a: '{x}', b: '{y}' }), {
      x: 'XX',
      y: 'He said "ship it" today',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentBody()).toEqual({ a: 'XX', b: 'He said "ship it" today' });
    expect(result).toEqual(expect.objectContaining({ success: true }));
  });

  it('sends a body whose substituted value contains a newline and a backslash', async () => {
    const result = await runSingleAction(webhookAction({ a: '{x}', commit: '{message}' }), {
      x: 'XX',
      message: 'Fix login\n\nC:\\Users\\ada\\notes',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentBody()).toEqual({ a: 'XX', commit: 'Fix login\n\nC:\\Users\\ada\\notes' });
    expect(result).toEqual(expect.objectContaining({ success: true }));
  });

  it('leaves a body without placeholders unchanged (control)', async () => {
    const result = await runSingleAction(webhookAction({ static: 'no placeholder here' }), {
      value: 'unused',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentBody()).toEqual({ static: 'no placeholder here' });
    expect(result).toEqual(expect.objectContaining({ success: true }));
  });
});
