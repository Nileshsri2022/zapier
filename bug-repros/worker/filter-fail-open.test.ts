/**
 * BUG (worker half of the unvalidated Zap-filter issue):
 * `evaluateCondition` returns `true` for any operator it does not recognise
 * (apps/worker/src/evaluateFilters.ts:65-67, "Default to passing for unknown
 * operators"). Combined with `PATCH /api/zaps/:zapId/filters` accepting any
 * operator string, a filter such as `{field: 'from', operator: 'regex'}` — or a
 * simple typo like `equal` — silently lets EVERY event through, so the Zap fires
 * for data the user explicitly asked to exclude.
 *
 * A filter that cannot be evaluated must fail closed (block the run), not open.
 *
 * Expected (green): unknown operators block.
 */
import { evaluateFilters } from '../../apps/worker/src/evaluateFilters';

const payload = { from: 'newsletter@shop.com', subject: 'Deal' };

describe('evaluateFilters unknown operators', () => {
  it('blocks on an operator it cannot evaluate (fail closed)', () => {
    // @ts-expect-error - deliberately not in the FilterCondition union
    expect(evaluateFilters([{ field: 'from', operator: 'regex', value: '.*' }], payload)).toBe(
      false
    );
  });

  it('blocks on a near-miss typo of a supported operator', () => {
    // @ts-expect-error - typo for 'equals'
    expect(evaluateFilters([{ field: 'from', operator: 'equal', value: 'x' }], payload)).toBe(false);
  });

  it('still evaluates the documented operators (control)', () => {
    expect(
      evaluateFilters([{ field: 'from', operator: 'equals', value: 'newsletter@shop.com' }], payload)
    ).toBe(true);
    expect(
      evaluateFilters([{ field: 'from', operator: 'equals', value: 'other@shop.com' }], payload)
    ).toBe(false);
    expect(evaluateFilters([], payload)).toBe(true);
  });
});
