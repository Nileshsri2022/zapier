import { PlaceholderError, resolvePlaceholders } from '../src';

/**
 * One resolution table for every action.
 *
 * The point of the module is that "what does `{a.b}` mean?" stops being a
 * per-action judgement call. These rows are that rule: notation, spacing,
 * recursion, JSON typing, and the cases that used to differ six ways.
 */

const RUN = {
  lead: { email: 'ada@acme.io', name: 'Ada', qty: 3, vip: true },
  message: 'hello',
  stepOutputs: { 2: { amount: 42 } },
  previousOutput: { fields: { name: 'Grace' } },
  nested: { deep: { value: 'found' } },
  payload: { id: 7 },
  '2': 'two',
};

const text = (value: unknown) => resolvePlaceholders(value, RUN) as string;
const json = (value: string) => resolvePlaceholders(value, RUN, { mode: 'json' });

describe('resolution never re-resolves its own output (injection)', () => {
  it('leaves a resolved value containing a placeholder literal', () => {
    // THE injection row. Run data is attacker-influenced; if a resolved value
    // were resolved again, a payload like "{admin.password}" would let incoming
    // data read fields the Zap author never referenced.
    const run = { message: '{admin.password}', admin: { password: 'hunter2' } };

    expect(resolvePlaceholders('{message}', run)).toBe('{admin.password}');
    expect(resolvePlaceholders('{"m":"{message}"}', run, { mode: 'json' })).toBe(
      '{"m":"{admin.password}"}'
    );
  });
});

describe('notation', () => {
  const cases: Array<[string, string, string]> = [
    ['double braces', '{{lead.name}}', 'Ada'],
    ['single braces', '{lead.name}', 'Ada'],
    ['double braces with inner space', '{{ lead.name }}', 'Ada'],
    ['single braces with inner space', '{ lead.name }', 'Ada'],
    ['dotted path', '{nested.deep.value}', 'found'],
    ['adjacent placeholders', '{lead.name}/{lead.email}', 'Ada/ada@acme.io'],
    ['three braces: outermost literal', '{{{lead.name}}}', '{Ada}'],
    ['four braces: two literals each side', '{{{{lead.name}}}}', '{{Ada}}'],
    ['numeric path segment', '{stepOutputs.2.amount}', '42'],
    ['array-free numeric key', '{2}', 'two'],
    ['notation inside prose', 'Hi {lead.name}, you ordered {lead.qty}.', 'Hi Ada, you ordered 3.'],
  ];

  it.each(cases)('%s', (_label, input, expected) => {
    expect(text(input)).toBe(expected);
  });

  const literal: Array<[string, string]> = [
    ['space inside a key is not a path', '{lead name}'],
    ['empty braces', '{}'],
    ['empty double braces', '{{}}'],
    ['unclosed brace', '{lead.name'],
    ['JSON punctuation is not a key', '{"lead.name":1}'],
    ['unknown key', '{missing.path}'],
  ];

  it.each(literal)('leaves %s literal', (_label, input) => {
    expect(text(input)).toBe(input);
  });

  it('keeps a null value literal rather than resolving it', () => {
    expect(resolvePlaceholders('{x}', { x: null })).toBe('{x}');
    expect(resolvePlaceholders('{x}', { x: undefined })).toBe('{x}');
  });

  it('does nothing to a string with no placeholders', () => {
    expect(text('plain text')).toBe('plain text');
    expect(text('')).toBe('');
  });
});

describe('graph walking', () => {
  it('walks nested objects', () => {
    expect(resolvePlaceholders({ a: { b: '{lead.name}' } }, RUN)).toEqual({
      a: { b: 'Ada' },
    });
  });

  it('walks arrays of objects and arrays of strings', () => {
    expect(
      resolvePlaceholders({ items: [{ name: '{lead.name}' }, '{message}'], tags: ['{lead.qty}'] }, RUN)
    ).toEqual({ items: [{ name: 'Ada' }, 'hello'], tags: ['3'] });
  });

  it('preserves non-string leaves untouched', () => {
    expect(resolvePlaceholders({ n: 1, b: false, z: null }, RUN)).toEqual({
      n: 1,
      b: false,
      z: null,
    });
  });

  it('stringifies resolved non-string values in text mode', () => {
    expect(text('qty={lead.qty} vip={lead.vip}')).toBe('qty=3 vip=true');
  });

  it('returns null and undefined inputs unchanged', () => {
    expect(resolvePlaceholders(null, RUN)).toBeNull();
    expect(resolvePlaceholders(undefined, RUN)).toBeUndefined();
  });
});

describe('json mode', () => {
  it('keeps a whole-value number native', () => {
    expect(json('{"qty":"{lead.qty}"}')).toBe('{"qty":3}');
  });

  it('keeps a whole-value boolean native', () => {
    expect(json('{"vip":"{{lead.vip}}"}')).toBe('{"vip":true}');
  });

  it('keeps a whole-value object native', () => {
    expect(json('{"payload":"{payload}"}')).toBe('{"payload":{"id":7}}');
  });

  it('keeps an embedded placeholder a string', () => {
    expect(json('{"text":"Order {lead.qty} items"}')).toBe('{"text":"Order 3 items"}');
  });

  it('substitutes every key in a multi-key body (issue #53)', () => {
    // The payload the old regex-over-serialized-text approach mangled: JSON's
    // own braces collided with the placeholder braces, so nothing resolved.
    expect(json('{"text":"{message}","nested":{"a":"{lead.name}"}}')).toBe(
      '{"text":"hello","nested":{"a":"Ada"}}'
    );
  });

  it('round-trips a value containing a double quote', () => {
    const run = { quote: 'He said "hi"' };
    const out = resolvePlaceholders('{"text":"{quote}"}', run, { mode: 'json' });

    expect(JSON.parse(out)).toEqual({ text: 'He said "hi"' });
  });

  it('round-trips a value containing a backslash and a newline', () => {
    const run = { value: 'C:\\path\nnext' };
    const out = resolvePlaceholders('{"text":"{value}"}', run, { mode: 'json' });

    expect(JSON.parse(out)).toEqual({ text: 'C:\\path\nnext' });
  });

  it('leaves an unknown key literal, so the body still parses', () => {
    const out = json('{"text":"{missing.path}"}');

    expect(JSON.parse(out)).toEqual({ text: '{missing.path}' });
  });

  it('resolves inside arrays of objects', () => {
    expect(json('{"items":[{"name":"{lead.name}"},{"n":"{lead.qty}"}]}')).toBe(
      '{"items":[{"name":"Ada"},{"n":3}]}'
    );
  });

  it('throws PlaceholderError INVALID_JSON on malformed input', () => {
    expect(() => json('{"a":')).toThrow(PlaceholderError);
    try {
      json('{"a":');
    } catch (error) {
      expect((error as PlaceholderError).code).toBe('INVALID_JSON');
    }
  });

  it('rejects a non-string input instead of guessing', () => {
    expect(() => resolvePlaceholders({ a: 1 } as never, RUN, { mode: 'json' })).toThrow(TypeError);
  });

  it('handles a JSON scalar body', () => {
    expect(json('null')).toBe('null');
    expect(json('"plain"')).toBe('"plain"');
  });
});

describe('positional passthrough (WhatsApp template slots)', () => {
  it('leaves numeric slots alone when positional is on', () => {
    expect(
      resolvePlaceholders('{"1":"x","2":"{lead.name}"}', RUN, {
        mode: 'json',
        positional: true,
      })
    ).toBe('{"1":"x","2":"Ada"}');
    expect(
      resolvePlaceholders('Hi {{1}}, order {lead.name}', RUN, { positional: true })
    ).toBe('Hi {{1}}, order Ada');
  });

  it('resolves numeric keys when positional is off', () => {
    expect(text('{2}')).toBe('two');
  });
});
