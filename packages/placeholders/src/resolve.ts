import { PlaceholderError } from './errors';

/**
 * Placeholder resolution — the one rule that turns step metadata into the
 * values an action actually uses.
 *
 * Notation (both accepted, `{{a.b}}` is the documented one):
 *   `{{a.b}}` · `{a.b}` · inner whitespace trimmed · `{a b}` is not a path
 *
 * Guarantees, in the order they matter:
 *
 * 1. **JSON mode output is always valid JSON.** The pipeline is
 *    parse → resolve → `JSON.stringify`, so a resolved value containing `"`,
 *    `\` or a newline can never break the body. Do not add escaping: the
 *    stringify at the end is what makes escaping unnecessary, and "defensive"
 *    escaping here would double-encode.
 * 2. **One pass, never re-resolved.** A resolved value that itself contains
 *    `{admin.password}` is emitted literally. Re-resolving would let run data
 *    inject references the author never wrote.
 * 3. **Unresolved stays literal.** A missing path (or a `null`/`undefined`
 *    value) leaves the placeholder text in place, so downstream validation
 *    (`isAddress`, URL parsing) fails loudly instead of sending an empty
 *    string and reporting success.
 */

export type RunMetadata = Record<string, unknown>;

export interface ResolveOptions {
  /** `text` (default) strings everything; `json` keeps native types and re-serialises. */
  mode?: 'text' | 'json';
  /** WhatsApp: numeric keys are Meta's template slots, not run metadata. */
  positional?: boolean;
}

/**
 * Double braces first, so `{{a.b}}` is never mistaken for `{` + `{a.b}` + `}`.
 * `[\w.]` keeps JSON punctuation out of the key: in text mode a serialized
 * body's own braces (`{"a":1}`) can never match a placeholder.
 */
const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}|\{\s*([\w.]+)\s*\}/g;

/** The same two shapes, anchored — a string that is *only* a placeholder. */
const WHOLE_PLACEHOLDER = /^(?:\{\{\s*([\w.]+)\s*\}\}|\{\s*([\w.]+)\s*\})$/;

function keyFrom(doubleKey?: string, singleKey?: string): string {
  return String(doubleKey ?? singleKey ?? '').trim();
}

/**
 * Walk a dotted path. Array indices work because `'2' in ['a','b','c']` is
 * true — `{stepOutputs.2.amount}` resolves against either a record or an array.
 */
function lookup(run: RunMetadata, key: string): { found: true; value: unknown } | { found: false } {
  let current: unknown = run;
  for (const part of key.split('.')) {
    if (current && typeof current === 'object' && part in (current as object)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return { found: false };
    }
  }
  if (current === undefined || current === null) return { found: false };
  return { found: true, value: current };
}

/** Resolve every placeholder inside one string. */
function resolveString(text: string, run: RunMetadata, options: ResolveOptions): string {
  return text.replace(PLACEHOLDER, (match: string, doubleKey?: string, singleKey?: string) => {
    const key = keyFrom(doubleKey, singleKey);
    if (!key) return match;
    if (options.positional && /^\d+$/.test(key)) return match;
    const hit = lookup(run, key);
    return hit.found ? String(hit.value) : match;
  });
}

/**
 * Walk the value graph. Strings resolve; arrays and plain objects recurse;
 * every other leaf (number, boolean, null) is returned untouched.
 */
function resolveGraph(value: unknown, run: RunMetadata, options: ResolveOptions): unknown {
  if (typeof value === 'string') {
    if (options.mode === 'json') {
      // A placeholder that is the whole string keeps its native type, so
      // `{"qty":"{qty}"}` becomes `{"qty":3}` rather than `{"qty":"3"}`.
      const whole = value.match(WHOLE_PLACEHOLDER);
      if (whole) {
        const key = keyFrom(whole[1], whole[2]);
        if (key && !(options.positional && /^\d+$/.test(key))) {
          const hit = lookup(run, key);
          if (hit.found) return hit.value;
        }
      }
    }
    return resolveString(value, run, options);
  }
  if (Array.isArray(value)) return value.map((entry) => resolveGraph(entry, run, options));
  if (value && typeof value === 'object') {
    const resolved: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      resolved[key] = resolveGraph(entry, run, options);
    }
    return resolved;
  }
  return value;
}

/** JSON mode: a JSON string in, a JSON string out. Result is always valid JSON. */
export function resolvePlaceholders(
  value: string,
  run: RunMetadata,
  options: { mode: 'json'; positional?: boolean }
): string;

/** Text mode (default): resolves strings, walked through objects and arrays. */
export function resolvePlaceholders(
  value: unknown,
  run: RunMetadata,
  options?: { mode?: 'text'; positional?: boolean }
): unknown;

export function resolvePlaceholders(
  value: unknown,
  run: RunMetadata,
  options: ResolveOptions = {}
): unknown {
  if (options.mode === 'json') {
    if (typeof value !== 'string') {
      // The contract is "JSON string in, JSON string out" — serialise first.
      throw new TypeError('resolvePlaceholders: json mode expects a JSON string');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch (error) {
      throw new PlaceholderError(
        'INVALID_JSON',
        `body is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    return JSON.stringify(resolveGraph(parsed, run, options));
  }
  return resolveGraph(value, run, options);
}
