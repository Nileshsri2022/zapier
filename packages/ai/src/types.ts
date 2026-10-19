import type { CapabilityProfileId } from '@repo/ai-connections';
export type AiProvider = 'openai' | 'anthropic' | 'puter' | 'openai_compatible';
export type AiMode = 'summarize' | 'classify' | 'extract' | 'custom';
export interface OutputField {
  name: string;
  type: 'text' | 'number' | 'boolean' | 'category_single' | 'category_multi';
  description?: string;
  options?: string[];
  isRequired: boolean;
}
export interface AiConfig {
  provider: AiProvider;
  connectionId?: string;
  model?: string;
  mode: AiMode;
  instructions: string;
  input: string;
  categories?: string[];
  outputFields?: OutputField[];
  temperature: number;
  maxOutputTokens: number;
}
export interface AiUsage {
  inputTokens?: number;
  outputTokens?: number;
}
export type FieldValue = string | number | boolean | string[] | null;
export interface AiStepOutput {
  output: string;
  fields: Record<string, FieldValue>;
  provider: AiProvider;
  model: string;
  mode: AiMode;
  usage?: AiUsage;
  truncated: boolean;
  latencyMs: number;
}
export interface ResolvedConnection {
  baseUrl: string;
  apiKey: string;
  capabilityProfileId: CapabilityProfileId;
}
export interface ExecutionState {
  repairUsed: boolean;
  startedAt: number;
  usage: AiUsage;
}
export interface AiExecutionContext {
  userId: number;
  env?: NodeJS.ProcessEnv;
  reserveCall: () => Promise<void>;
  resolveConnection?: (id: string, userId: number) => Promise<ResolvedConnection>;
  state?: ExecutionState;
}
export interface ProviderRequest {
  provider: AiProvider;
  model: string;
  apiKey: string;
  system: string;
  input: string;
  schema?: Record<string, unknown>;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
  maxResponseBytes: number;
  connection?: ResolvedConnection;
  allowedHosts: readonly string[];
}
export interface ProviderResult {
  text?: string;
  structured?: unknown;
  usage?: AiUsage;
}
