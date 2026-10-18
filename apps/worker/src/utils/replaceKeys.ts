/**
 * Template placeholder resolution for action metadata.
 *
 * Extracted from index.ts so the exact semantics downstream steps rely on
 * (`{previousOutput.fields.x}`, `{stepOutputs.2.…}`) are unit-testable
 * without booting the worker's Kafka consumer — same reason the action-type
 * guard was extracted in F3 (see utils/actionTypes.ts).
 *
 * Semantics (unchanged from the original inline implementation):
 * - `{a.b.c}` walks nested objects key by key.
 * - Unknown/missing paths are left as the literal `{a.b.c}` placeholder.
 * - Resolved values are stringified (`String(value)`); referencing a whole
 *   object yields "[object Object]" — reference scalar leaves instead.
 */
export function replaceKeys(template: string, replacements: Record<string, any>): string {
  return template.replace(/{(.*?)}/g, (_, key) => {
    // Support nested keys like {previousOutput.amount} or {data.user.email}
    const keys = key.split('.');
    let value: any = replacements;

    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        return `{${key}}`; // Key not found, return placeholder
      }
    }

    return value !== undefined && value !== null ? String(value) : `{${key}}`;
  });
}
