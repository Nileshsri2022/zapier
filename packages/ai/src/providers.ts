import { requestCompatible } from '@repo/ai-connections';
import { AiStepError, providerHttpError, safeAiError } from './errors';
import { AiUsage, ProviderRequest, ProviderResult } from './types';
import { callPuter } from './puter';

export function reportedUsage(
  value: unknown,
  inputKey: string,
  outputKey: string
): AiUsage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const usage: AiUsage = {};
  const input = raw[inputKey];
  const output = raw[outputKey];
  if (typeof input === 'number' && Number.isSafeInteger(input) && input >= 0)
    usage.inputTokens = input;
  if (typeof output === 'number' && Number.isSafeInteger(output) && output >= 0)
    usage.outputTokens = output;
  return Object.keys(usage).length ? usage : undefined;
}
export function chatBody(request: ProviderRequest) {
  const profile = request.connection?.capabilityProfileId ?? 'chat_json_schema';
  const format =
    request.schema && profile !== 'chat_prompt_json'
      ? profile === 'chat_json_object'
        ? { type: 'json_object' }
        : {
            type: 'json_schema',
            json_schema: { name: 'zapmate_ai_output', strict: true, schema: request.schema },
          }
      : undefined;
  return {
    model: request.model,
    messages: [
      { role: 'system', content: request.system },
      { role: 'user', content: request.input },
    ],
    temperature: request.temperature,
    max_tokens: request.maxOutputTokens,
    stream: false,
    ...(format ? { response_format: format } : {}),
  };
}
let directInFlight = 0;
async function boundedJsonFetch(
  request: ProviderRequest,
  url: string,
  body: unknown,
  headers: Record<string, string>
): Promise<unknown> {
  if (directInFlight >= 10) throw new AiStepError('AI outbound concurrency limit reached', true);
  directInFlight++;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw providerHttpError(response.status);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new AiStepError('AI provider returned an empty response');
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > request.maxResponseBytes) {
          controller.abort();
          throw new AiStepError('AI provider response exceeded its size limit');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new AiStepError('AI provider returned malformed response JSON');
    }
  } catch (error) {
    if (error instanceof AiStepError) throw error;
    if (
      error &&
      typeof error === 'object' &&
      'name' in error &&
      (error.name === 'AbortError' || error.name === 'TimeoutError')
    )
      throw new AiStepError('AI provider request timed out', true, undefined, 'timeout');
    // HTTP transport errors are sanitized, never leak URL, headers or provider body.
    throw new AiStepError(
      'AI provider network request failed',
      true,
      undefined,
      'provider_unavailable'
    );
  } finally {
    clearTimeout(timer);
    directInFlight--;
  }
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function parseChatResponse(value: unknown): ProviderResult {
  const raw = object(value);
  const choice = object(Array.isArray(raw.choices) ? raw.choices[0] : undefined);
  const message = object(choice.message);
  const finish = String(choice.finish_reason || '');
  if (message.refusal || finish === 'content_filter')
    throw new AiStepError(
      'AI provider refused to process this content',
      false,
      undefined,
      'policy_refusal'
    );
  if (finish === 'tool_calls')
    throw new AiStepError('AI provider returned an unsupported tool-call response');
  return {
    text: typeof message.content === 'string' ? message.content : undefined,
    // Output hitting max-tokens is a truncation FLAG, not an error (spec §5).
    truncated: finish === 'length' ? true : undefined,
    usage: reportedUsage(raw.usage, 'prompt_tokens', 'completion_tokens'),
  };
}
export type CompatibleSender = typeof requestCompatible;
export async function callProvider(
  request: ProviderRequest,
  compatible: CompatibleSender = requestCompatible
): Promise<ProviderResult> {
  try {
    if (request.provider === 'puter') return await callPuter(request);
    if (request.provider === 'anthropic') {
      const schema = request.schema;
      const raw = object(
        await boundedJsonFetch(
          request,
          'https://api.anthropic.com/v1/messages',
          {
            model: request.model,
            system: request.system,
            messages: [{ role: 'user', content: request.input }],
            temperature: request.temperature,
            max_tokens: request.maxOutputTokens,
            ...(schema
              ? {
                  tools: [
                    {
                      name: 'emit_output',
                      description: 'Return the transformed data',
                      input_schema: schema,
                    },
                  ],
                  tool_choice: {
                    type: 'tool',
                    name: 'emit_output',
                    disable_parallel_tool_use: true,
                  },
                }
              : {}),
          },
          { 'x-api-key': request.apiKey, 'anthropic-version': '2023-06-01' }
        )
      );
      const stop = String(raw.stop_reason || '');
      if (stop === 'refusal')
        throw new AiStepError(
          'AI provider refused to process this content',
          false,
          undefined,
          'policy_refusal'
        );
      const anthropicTruncated = stop === 'max_tokens' ? true : undefined;
      const blocks = Array.isArray(raw.content) ? raw.content.map(object) : [];
      return {
        ...(schema
          ? {
              structured: blocks.find((b) => b.type === 'tool_use' && b.name === 'emit_output')
                ?.input,
            }
          : {
              text: blocks
                .filter((b) => b.type === 'text')
                .map((b) => b.text)
                .filter((t) => typeof t === 'string')
                .join(''),
            }),
        truncated: anthropicTruncated,
        usage: reportedUsage(raw.usage, 'input_tokens', 'output_tokens'),
      };
    }
    if (request.provider === 'openai_compatible') {
      if (!request.connection) throw new AiStepError('AI compatible connection is required');
      const response = await compatible({
        baseUrl: request.connection.baseUrl,
        apiKey: request.apiKey,
        allowedHosts: request.allowedHosts,
        body: chatBody(request),
        timeoutMs: request.timeoutMs,
        maxResponseBytes: request.maxResponseBytes,
      });
      if (response.status < 200 || response.status >= 300) throw providerHttpError(response.status);
      try {
        return parseChatResponse(JSON.parse(response.body));
      } catch (error) {
        if (error instanceof AiStepError) throw error;
        throw new AiStepError('AI provider returned malformed response JSON');
      }
    }
    return parseChatResponse(
      await boundedJsonFetch(
        request,
        'https://api.openai.com/v1/chat/completions',
        chatBody(request),
        { Authorization: `Bearer ${request.apiKey}` }
      )
    );
  } catch (error) {
    throw safeAiError(error);
  }
}
