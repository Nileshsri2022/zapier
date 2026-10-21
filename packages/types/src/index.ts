import { z } from 'zod';

// Auth Schemas
const SignupSchema = z.object({
  name: z.string().min(3, { message: 'Name must have three characters' }),
  email: z.string().email({ message: 'Enter a valid email' }),
  password: z.string().min(8, { message: 'Password must have 8 characters' }),
});

type TSignup = z.infer<typeof SignupSchema>;

const SigninSchema = z.object({
  email: z.string().email({ message: 'Enter a valid email' }),
  password: z.string().min(8),
});

type TSignin = z.infer<typeof SigninSchema>;

// Per-action conditions use the existing worker evaluator (AND semantics).
export const StepConditionSchema = z.object({
  field: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)*$/)
    .refine(
      (path) =>
        !path.split('.').some((part) => ['__proto__', 'prototype', 'constructor'].includes(part))
    ),
  operator: z.enum([
    'equals',
    'not_equals',
    'contains',
    'not_contains',
    'greater_than',
    'less_than',
    'greater_than_or_equals',
    'less_than_or_equals',
    'is_empty',
    'is_not_empty',
    'starts_with',
    'ends_with',
  ]),
  value: z.string().max(1000).default(''),
});
export type StepCondition = z.infer<typeof StepConditionSchema>;
const MAX_CONDITIONS = 20;
const stepConditions = z.array(StepConditionSchema).max(MAX_CONDITIONS).optional();

// Zap-level filters are evaluated by the worker's `evaluateFilters`, the same
// function that evaluates per-step conditions, so a filter condition has exactly
// the shape a step condition has — including the operator enum the evaluator
// implements. Validating here stops an operator the worker cannot evaluate from
// ever reaching the database (see #49); the worker also fails closed on one
// (#50).
const UpdateZapFiltersSchema = z.object({
  filterConditions: z.array(StepConditionSchema).max(MAX_CONDITIONS),
});
type TUpdateZapFilters = z.infer<typeof UpdateZapFiltersSchema>;

// ZapSchemas
const CreateZapSchema = z.object({
  availableTriggerId: z.string(),
  triggerMetaData: z.any().optional(),
  actions: z
    .object({
      availableActionId: z.string(),
      actionMetaData: z.any().optional(),
      stepConditions,
    })
    .array(),
});

type TCreateZap = z.infer<typeof CreateZapSchema>;

const SelectedTriggerSchema = z.object({
  availableTriggerId: z.string(),
  triggerType: z.string(),
  triggerMetaData: z.any().optional(),
});

type TSelectedTrigger = z.infer<typeof SelectedTriggerSchema>;

const SelectedActionSchema = z.object({
  availableActionId: z.string(),
  actionType: z.string(),
  actionMetaData: z.any().optional(),
  stepConditions,
});

type TSelectedAction = z.infer<typeof SelectedActionSchema>;

// Zap Operation Schemas
const RenameZapSchema = z.object({
  name: z.string().min(1, { message: 'Name is required' }).max(100, { message: 'Name too long' }),
});

type TRenameZap = z.infer<typeof RenameZapSchema>;

const EnableZapSchema = z.object({
  isActive: z.boolean(),
});

type TEnableZap = z.infer<typeof EnableZapSchema>;

const UpdateZapActionsSchema = z.object({
  actions: z.array(
    z.object({
      availableActionId: z.string(),
      actionMetaData: z.any().optional(),
      stepConditions,
    })
  ),
});

type TUpdateZapActions = z.infer<typeof UpdateZapActionsSchema>;

// Telegram Bot Schema
const ConnectTelegramBotSchema = z.object({
  botToken: z.string().min(1, { message: 'Bot token is required' }),
  botName: z.string().min(1, { message: 'Bot name is required' }),
});

type TConnectTelegramBot = z.infer<typeof ConnectTelegramBotSchema>;

// WhatsApp Server Schema
const ConnectWhatsAppSchema = z.object({
  displayName: z.string().min(1, { message: 'Display name is required' }),
  accessToken: z.string().min(1, { message: 'Access token is required' }),
  // Required and non-empty: `WhatsAppServer.phoneNumberId` is `@unique` in
  // Prisma, so a persisted `''` lets exactly one account in the platform
  // connect and fails every later attempt as "already registered" (#41).
  phoneNumberId: z.string().trim().min(1, { message: 'Phone number ID is required' }),
  businessId: z.string().optional(),
  phoneNumber: z.string().optional(),
});

type TConnectWhatsApp = z.infer<typeof ConnectWhatsAppSchema>;

// Pagination Schema (for query params)
const PaginationQuerySchema = z.object({
  page: z
    .string()
    .regex(/^\d+$/)
    .optional()
    .transform((val) => (val ? parseInt(val) : 1)),
  limit: z
    .string()
    .regex(/^\d+$/)
    .optional()
    .transform((val) => (val ? parseInt(val) : 20)),
});

type TPaginationQuery = z.infer<typeof PaginationQuerySchema>;

export {
  SignupSchema,
  SigninSchema,
  CreateZapSchema,
  RenameZapSchema,
  EnableZapSchema,
  UpdateZapActionsSchema,
  UpdateZapFiltersSchema,
  ConnectTelegramBotSchema,
  ConnectWhatsAppSchema,
  PaginationQuerySchema,
};

export type {
  TSignup,
  TSignin,
  TCreateZap,
  TSelectedTrigger,
  TSelectedAction,
  TRenameZap,
  TEnableZap,
  TUpdateZapActions,
  TUpdateZapFilters,
  TConnectTelegramBot,
  TConnectWhatsApp,
  TPaginationQuery,
};

export * from './ai';
