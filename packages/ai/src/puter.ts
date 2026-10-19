import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { AiStepError, providerHttpError } from './errors';
import { ProviderRequest, ProviderResult } from './types';

let inFlight = 0;
/** SDK is isolated so a timeout terminates local SDK/network activity, not merely a Promise.race.
 * An upstream accepted request can still be billed. Production verification remains required.
 */
export async function callPuter(request: ProviderRequest): Promise<ProviderResult> {
  if (Number(process.versions.node.split('.')[0]) < 22)
    throw new AiStepError('Puter SDK adapter requires Node.js 22 or newer');
  if (inFlight >= 10) throw new AiStepError('AI outbound concurrency limit reached', true);
  inFlight++;
  let worker: Worker | undefined;
  try {
    return await new Promise<ProviderResult>((resolve, reject) => {
      let settled = false;
      const finish = (value?: ProviderResult, error?: AiStepError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(value!);
      };
      const timer = setTimeout(
        () => finish(undefined, new AiStepError('Puter request timed out', true)),
        request.timeoutMs
      );
      try {
        worker = new Worker(path.join(__dirname, 'puterThread.js'), {
          workerData: request,
          stdout: true,
          stderr: true,
          execArgv: [],
          // Prevent server credentials and endpoint override env vars from entering the SDK worker.
          env: {},
          resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 },
        });
        worker.stdout?.resume();
        worker.stderr?.resume();
        worker.once(
          'message',
          (message: { ok?: boolean; result?: ProviderResult; status?: number }) => {
            if (message.ok && message.result) finish(message.result);
            else
              finish(
                undefined,
                typeof message.status === 'number'
                  ? providerHttpError(message.status)
                  : new AiStepError('Puter SDK request failed; check account configuration')
              );
          }
        );
        worker.once('error', () =>
          finish(undefined, new AiStepError('Puter SDK execution failed'))
        );
        worker.once('exit', () =>
          finish(undefined, new AiStepError('Puter SDK exited before returning a result'))
        );
      } catch {
        finish(undefined, new AiStepError('Puter SDK could not be initialized'));
      }
    });
  } finally {
    // Keep the concurrency permit until termination completes.
    try {
      if (worker) await worker.terminate();
    } finally {
      inFlight--;
    }
  }
}
