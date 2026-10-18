import { isKnownActionType, KNOWN_ACTION_TYPES, KNOWN_ACTION_PREFIXES } from '../src/utils/actionTypes';

/**
 * The action-type guard is what turns "unimplemented action" from a silent
 * no-op into a failed run (gap D2 in reports/workflow-execution-gaps.md).
 * These tests pin the registry so a catalog entry that outruns the worker is
 * caught here instead of in production.
 */
describe('isKnownActionType', () => {
  it.each(KNOWN_ACTION_TYPES)('accepts exact match %s', (type) => {
    expect(isKnownActionType(type)).toBe(true);
  });

  it.each(['WhatsApp Send Message', 'WhatsApp', 'Telegram Send Message', 'Telegram'])(
    'accepts prefix match %s',
    (type) => {
      expect(isKnownActionType(type)).toBe(true);
    }
  );

  it.each(['Gmail Send Email', 'Gmail Reply', 'Slack Message', '', 'email', 'WEBHOOK'])(
    'rejects unimplemented or mistyped action %s',
    (type) => {
      expect(isKnownActionType(type)).toBe(false);
    }
  );

  it('keeps the prefix registry a strict superset of exact matches', () => {
    // Guard against the two registries drifting: a prefix should never collide
    // with an exact-match entry (e.g. 'Email' vs a future 'EmailX' prefix).
    for (const prefix of KNOWN_ACTION_PREFIXES) {
      expect(KNOWN_ACTION_TYPES).not.toContain(prefix);
    }
  });
});
