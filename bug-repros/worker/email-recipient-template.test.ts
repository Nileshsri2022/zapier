/**
 * BUG: the Email action never templates its recipient. `apps/worker/src/index.ts`
 * validates the RAW `metadata.to` (`validateEmail(to)`, line 83) while `body`
 * and `subject` do go through `replaceKeys`. When `to` holds a placeholder such
 * as `{lead.email}` the validation fails and the code falls back to slicing the
 * serialized run metadata:
 *
 *   searchKey.slice(searchKey.indexOf('email') + 8, searchKey.indexOf('.com') + 4)
 *
 * That heuristic yields '' whenever the payload has no `.com` (or the first
 * `.com` appears before the first `email` key), and picks an unrelated address
 * otherwise. The email is silently sent to a wrong/empty recipient — or the run
 * fails with a confusing provider error.
 *
 * Expected (green): `to` is templated with `replaceKeys` like the other fields.
 */
import { emailSend, runSingleAction } from './runHarness';

beforeEach(() => {
  jest.clearAllMocks();
  emailSend.mockResolvedValue({ success: true, messageId: 'm-1' });
});

describe('Email action recipient templating', () => {
  it('sends to the templated address (non-.com TLD)', async () => {
    const result = await runSingleAction(
      {
        type: 'Email',
        metadata: { to: '{lead.email}', subject: 'Hi {lead.name}', body: 'Hello {lead.name}' },
      },
      { lead: { email: 'ops@acme.io', name: 'Ada' } }
    );

    expect(emailSend).toHaveBeenCalledWith('ops@acme.io', 'Hi Ada', expect.any(String));
    expect(result).toEqual(expect.objectContaining({ success: true }));
  });

  it('sends to the templated address even when another .com address appears earlier in the payload', async () => {
    await runSingleAction(
      { type: 'Email', metadata: { to: '{lead.email}', subject: 'Hi', body: 'Hello' } },
      // A Gmail trigger payload: `from` contains the first ".com" in the JSON,
      // so the slice-based fallback computes slice(start, end) with end < start.
      { from: 'billing@shop.com', lead: { email: 'ops@acme.com' } }
    );

    expect(emailSend).toHaveBeenCalledWith('ops@acme.com', 'Hi', 'Hello');
  });

  it('still honours a literal address', async () => {
    await runSingleAction(
      { type: 'Email', metadata: { to: 'fixed@example.com', subject: 'Hi', body: 'Hello' } },
      { from: 'billing@shop.com' }
    );

    expect(emailSend).toHaveBeenCalledWith('fixed@example.com', 'Hi', 'Hello');
  });
});
