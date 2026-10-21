import { parentPort, workerData } from 'node:worker_threads';
import { ProviderRequest } from './types';
import { reportedUsage } from './providers';

async function main() {
  const request = workerData as ProviderRequest;
  // Documented Node entry point. Never call getAuthToken or an interactive login here.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { init } = require('@heyputer/puter.js/src/init.cjs');
  const puter = init(request.apiKey);
  const raw = await puter.ai.chat(
    [
      { role: 'system', content: request.system },
      { role: 'user', content: request.input },
    ],
    {
      model: request.model,
      temperature: request.temperature,
      max_tokens: request.maxOutputTokens,
      stream: false,
      normalize: true,
    }
  );
  // SDK responses can contain functions. Serialize only inside isolation and enforce IPC size.
  const serialized = JSON.stringify(raw);
  if (Buffer.byteLength(serialized) > request.maxResponseBytes) throw new Error();
  const result = JSON.parse(serialized);
  if (result.message?.refusal) {
    parentPort?.postMessage({ ok: false, refusal: true });
    return;
  }
  const content = result.message?.content;
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .filter((part: { type?: string }) => part.type === 'text')
            .map((part: { text?: string }) => part.text || '')
            .join('')
        : undefined;
  parentPort?.postMessage({
    ok: true,
    result: {
      text,
      // Output hitting max-tokens is a truncation FLAG, not an error (spec §5).
      truncated: result.finish_reason === 'length' ? true : undefined,
      usage:
        reportedUsage(result.usage, 'prompt_tokens', 'completion_tokens') ??
        reportedUsage(result.usage, 'input_tokens', 'output_tokens'),
    },
  });
}
main().catch((error: unknown) => {
  const status =
    error && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
      ? error.status
      : undefined;
  parentPort?.postMessage({
    ok: false,
    status: status && status >= 400 && status <= 599 ? status : undefined,
  });
});
