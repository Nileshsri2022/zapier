import { replaceKeys } from '../src/utils/replaceKeys';

/**
 * replaceKeys is the worker's only templating mechanism — every action's
 * downstream references (`{previousOutput.…}`, `{stepOutputs.2.…}`,
 * trigger payload keys, and now Email subjects) resolve through it.
 * These tests pin its long-standing semantics so a refactor can't silently
 * change what user Zaps receive (see reports/gmail-worker-routing-spec.md D8).
 */
describe('replaceKeys', () => {
  const context = {
    subject: 'Invoice #42',
    from: 'billing@example.com',
    previousOutput: { output: 'summary text', fields: { category: 'negative', amount: 1499 } },
    stepOutputs: { '2': { fields: { orderId: '84120' } } },
    nothing: null,
  };

  it('resolves flat trigger-payload keys (e.g. an Email subject)', () => {
    expect(replaceKeys('Fwd: {subject} (from {from})', context)).toBe(
      'Fwd: Invoice #42 (from billing@example.com)'
    );
  });

  it('resolves nested previousOutput and stepOutputs paths', () => {
    expect(replaceKeys('{previousOutput.fields.category}', context)).toBe('negative');
    expect(replaceKeys('order {stepOutputs.2.fields.orderId}', context)).toBe('order 84120');
  });

  it('stringifies scalar leaves', () => {
    expect(replaceKeys('{previousOutput.fields.amount}', context)).toBe('1499');
  });

  it('leaves unknown, missing, and null paths as literal placeholders', () => {
    expect(replaceKeys('{nope}', context)).toBe('{nope}');
    expect(replaceKeys('{previousOutput.fields.missing}', context)).toBe(
      '{previousOutput.fields.missing}'
    );
    expect(replaceKeys('{nothing}', context)).toBe('{nothing}');
  });

  it('does not resolve legacy server-side {{double_brace}} templates', () => {
    // The old inline executor used {{key}}; the worker never has. Gmail Zaps
    // are migrated by reports/gmail-worker-routing-spec.md's rewrite script.
    expect(replaceKeys('{{subject}}', context)).not.toBe('Invoice #42');
    expect(replaceKeys('{{subject}}', context)).toContain('subject');
  });

  it('passes placeholder-free templates through unchanged', () => {
    expect(replaceKeys(' plain subject ', context)).toBe(' plain subject ');
    expect(replaceKeys('', context)).toBe('');
  });
});
