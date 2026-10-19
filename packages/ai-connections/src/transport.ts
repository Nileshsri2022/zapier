import https from 'node:https';
import { AiConnectionError } from './errors';
import { normalizeBaseUrl, resolvePublicAddress, Resolver } from './policy';

export interface SafeRequestOptions {
  baseUrl: string;
  allowedHosts: readonly string[];
  apiKey: string;
  body: unknown;
  timeoutMs?: number;
  maxResponseBytes?: number;
}
export interface SafeResponse {
  status: number;
  body: string;
}

/** Server-only. DNS validated on every request; pinned IP with original TLS hostname verification.
 * No redirects, pooled sockets, caller-selected headers, proxy env vars or second DNS lookup.
 */
export function createCompatibleTransport(resolver?: Resolver) {
  let inFlight = 0;
  return async (options: SafeRequestOptions): Promise<SafeResponse> => {
    if (inFlight >= 10)
      throw new AiConnectionError('TRANSPORT', 'AI outbound concurrency limit reached');
    const baseUrl = normalizeBaseUrl(options.baseUrl, options.allowedHosts);
    if (!options.apiKey || !/^[!-~]+$/.test(options.apiKey) || options.apiKey.length > 8192) {
      throw new AiConnectionError('INVALID_INPUT', 'Invalid AI connection credential');
    }
    const timeoutMs = options.timeoutMs ?? 60000;
    const maxBytes = options.maxResponseBytes ?? 1048576;
    if (
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 60000 ||
      !Number.isInteger(maxBytes) ||
      maxBytes < 1 ||
      maxBytes > 1048576
    ) {
      throw new AiConnectionError('INVALID_INPUT', 'Invalid AI request bounds');
    }
    const body = JSON.stringify(options.body);
    if (!body || Buffer.byteLength(body) > 1048576) {
      throw new AiConnectionError('INVALID_INPUT', 'AI request body is too large');
    }
    inFlight++;
    try {
      return await new Promise<SafeResponse>((resolve, reject) => {
        let request: ReturnType<typeof https.request> | undefined;
        let settled = false;
        const fail = (error?: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          request?.destroy();
          reject(
            error instanceof AiConnectionError && error.code === 'ENDPOINT_BLOCKED'
              ? error
              : new AiConnectionError(
                  'TRANSPORT',
                  'AI endpoint request failed or exceeded its bounds'
                )
          );
        };
        // Includes DNS, TLS, request and response wall time. Late DNS results cannot dispatch after expiry.
        const timer = setTimeout(fail, timeoutMs);
        const url = new URL(`${baseUrl}/chat/completions`);
        resolvePublicAddress(url.hostname, resolver)
          .then((destination) => {
            if (settled) return;
            request = https.request(
              {
                protocol: 'https:',
                hostname: destination.address,
                family: destination.family,
                port: 443,
                servername: url.hostname,
                path: url.pathname,
                method: 'POST',
                agent: false,
                rejectUnauthorized: true,
                headers: {
                  Host: url.hostname,
                  Authorization: `Bearer ${options.apiKey}`,
                  'Content-Type': 'application/json',
                  'Content-Length': Buffer.byteLength(body),
                },
              },
              (response) => {
                const status = response.statusCode ?? 0;
                if (status < 200 || status >= 600 || (status >= 300 && status < 400)) {
                  response.destroy();
                  fail();
                  return;
                }
                const chunks: Buffer[] = [];
                let bytes = 0;
                response.on('data', (chunk: Buffer) => {
                  bytes += chunk.length;
                  if (bytes > maxBytes) {
                    response.destroy();
                    fail();
                  } else chunks.push(chunk);
                });
                response.on('error', fail);
                response.on('aborted', fail);
                response.on('end', () => {
                  if (settled) return;
                  settled = true;
                  clearTimeout(timer);
                  resolve({ status, body: Buffer.concat(chunks).toString('utf8') });
                });
              }
            );
            request.on('error', fail);
            request.end(body);
          })
          .catch(fail);
      });
    } finally {
      inFlight--;
    }
  };
}

export const requestCompatible = createCompatibleTransport();
