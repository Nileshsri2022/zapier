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

// ZapSchemas
const CreateZapSchema = z.object({
  availableTriggerId: z.string(),
  triggerMetaData: z.any().optional(),
  actions: z
    .object({
      availableActionId: z.string(),
      actionMetaData: z.any().optional(),
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
  phoneNumberId: z.string().optional(),
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
  TConnectTelegramBot,
  TConnectWhatsApp,
  TPaginationQuery,
};
