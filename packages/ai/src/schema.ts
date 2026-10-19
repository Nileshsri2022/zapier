import { AiConfig, FieldValue } from './types';
import { AiStepError } from './errors';
const invalid = (): never => {
  throw new AiStepError('AI output did not match the required format');
};
export function buildJsonSchema(config: AiConfig): Record<string, unknown> | undefined {
  if (config.mode === 'classify')
    return {
      type: 'object',
      properties: { category: { type: 'string', enum: config.categories } },
      required: ['category'],
      additionalProperties: false,
    };
  if (!config.outputFields?.length) return undefined;
  const properties: Record<string, unknown> = Object.create(null);
  for (const field of config.outputFields) {
    let property: Record<string, unknown> =
      field.type === 'category_multi'
        ? { type: 'array', items: { type: 'string', enum: field.options } }
        : field.type === 'category_single'
          ? { type: 'string', enum: field.options }
          : { type: field.type === 'text' ? 'string' : field.type };
    if (!field.isRequired) property = { anyOf: [property, { type: 'null' }] };
    if (field.description) property.description = field.description;
    properties[field.name] = property;
  }
  // Strict schemas require every property; optional business fields are nullable.
  return {
    type: 'object',
    properties,
    required: config.outputFields.map((f) => f.name),
    additionalProperties: false,
  };
}
export function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(
      text
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
    );
  } catch {
    return invalid();
  }
}
export function validateAndCoerce(value: unknown, config: AiConfig): Record<string, FieldValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const parsed = value as Record<string, unknown>;
  if (config.mode === 'classify') {
    if (typeof parsed.category !== 'string' || !config.categories?.includes(parsed.category))
      return invalid();
    return { category: parsed.category };
  }
  const fields: Record<string, FieldValue> = {};
  for (const field of config.outputFields || []) {
    let v = Object.hasOwn(parsed, field.name) ? parsed[field.name] : undefined;
    if (v === undefined || v === null) {
      if (field.isRequired) return invalid();
      fields[field.name] = null;
      continue;
    }
    if (field.type === 'number') {
      if (typeof v === 'string' && /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(v.trim()))
        v = Number(v);
      if (typeof v !== 'number' || !Number.isFinite(v)) return invalid();
    } else if (field.type === 'boolean') {
      if (v === 'true') v = true;
      else if (v === 'false') v = false;
      if (typeof v !== 'boolean') return invalid();
    } else if (field.type === 'category_multi') {
      if (
        !Array.isArray(v) ||
        v.some((entry) => typeof entry !== 'string' || !field.options?.includes(entry))
      )
        return invalid();
      v = [...new Set(v)];
    } else if (
      typeof v !== 'string' ||
      (field.type === 'category_single' && !field.options?.includes(v))
    )
      return invalid();
    fields[field.name] = v as FieldValue;
  }
  return fields;
}
