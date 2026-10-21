import { z } from 'zod';

const unique = (items: string[]) => new Set(items).size === items.length;
const options = z
  .array(z.string().trim().min(1).max(60))
  .min(2)
  .max(50)
  .refine(unique, 'Options must be unique');
export const AiOutputFieldSchema = z
  .object({
    name: z
      .string()
      .max(50)
      .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/)
      .refine(
        (name) => !['__proto__', 'prototype', 'constructor'].includes(name),
        'Reserved field name'
      ),
    type: z.enum(['text', 'number', 'boolean', 'category_single', 'category_multi']),
    description: z.string().max(200).optional(),
    options: options.optional(),
    isRequired: z.boolean(),
  })
  .superRefine((field, ctx) => {
    if (field.type.startsWith('category_') !== Boolean(field.options)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Options are required only for category fields',
        path: ['options'],
      });
    }
  });
const base = z.object({
  provider: z.enum(['openai', 'anthropic', 'puter', 'openai_compatible']),
  connectionId: z.string().uuid().optional(),
  model: z.string().trim().max(200).optional(),
  mode: z.enum(['summarize', 'classify', 'extract', 'generate', 'translate', 'custom']),
  input: z
    .string()
    .min(1)
    .max(4000)
    .refine((s) => Boolean(s.trim()), 'Input is required'),
  instructions: z.string().max(4000).default(''),
  categories: z
    .array(z.string().trim().min(1).max(60))
    .min(2)
    .max(20)
    .refine(unique, 'Categories must be unique')
    .optional(),
  outputFields: z
    .array(AiOutputFieldSchema)
    .max(25)
    .refine((fields) => unique(fields.map((field) => field.name)), 'Field names must be unique')
    .optional(),
  temperature: z.number().min(0).max(1).default(0),
  maxOutputTokens: z.number().int().min(16).max(2000).default(500),
});
function coherent(config: z.infer<typeof base>, ctx: z.RefinementCtx) {
  const issue = (path: string, message: string) =>
    ctx.addIssue({ code: 'custom', path: [path], message });
  if (config.provider === 'openai_compatible') {
    if (!config.connectionId) issue('connectionId', 'Select an AI connection');
    if (!config.model?.trim()) issue('model', 'Model is required for compatible connections');
  } else if (config.connectionId)
    issue('connectionId', 'Connection is only valid for OpenAI-compatible providers');
  if (config.mode === 'classify' && !config.categories)
    issue('categories', 'Categories are required');
  if (config.mode === 'extract' && !config.outputFields?.length)
    issue('outputFields', 'At least one field is required');
  if (config.mode === 'custom' && !config.instructions.trim())
    issue('instructions', 'Instructions are required');
}
function normalize(config: z.infer<typeof base>) {
  const { categories, outputFields, ...rest } = config;
  return {
    ...rest,
    ...(config.mode === 'classify' ? { categories } : {}),
    ...(['extract', 'custom'].includes(config.mode) && outputFields ? { outputFields } : {}),
  };
}
export const AiActionMetaDataSchema = base.superRefine(coherent).transform(normalize);
export const AiTestSchema = base
  .extend({
    input: z
      .string()
      .min(1)
      // Q-AI-04: sample input follows the same 50k limit as run input.
      .max(50000)
      .refine((s) => Boolean(s.trim()), 'Sample input is required'),
  })
  .superRefine(coherent)
  .transform(normalize);
export type AiActionMetaData = z.infer<typeof AiActionMetaDataSchema>;
