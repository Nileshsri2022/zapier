/**
 * A4 — Webhook action / outbound HTTP request (docs/ask-matt/actions/webhook.md,
 * grilled round 14). Distinct from T5's incoming catch hook.
 *
 * Q-WHA-01 five REST verbs · Q-WHA-02 none/basic/bearer/api-key auth ·
 * Q-WHA-03 json/form/raw bodies · Q-WHA-04 status + parsed body + headers ·
 * Q-WHA-05 idempotent-only retries (GET/PUT/DELETE; POST/PATCH fail fast) ·
 * Q-WHA-06 non-2xx is an error by default with a per-step override.
 */

import { PlaceholderError, resolvePlaceholders } from '@repo/placeholders';

export type WebhookErrorCode =
  | 'validation'
  | 'blocked_target'
  | 'network'
  | 'timeout'
  | 'http_status'
  | 'too_many_redirects';

export class WebhookActionError extends Error {
  constructor(
    message: string,
    public readonly code: WebhookErrorCode,
    public readonly retryable = false,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'WebhookActionError';
  }
}

export const FIVE_VERBS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type WebhookMethod = (typeof FIVE_VERBS)[number];

export const MAX_REDIRECTS = 5;
export const RESPONSE_MAX_BYTES = 10 * 1024 * 1024; // spec §5: 10 MB cap
export const DEFAULT_TIMEOUT_MS = 30_000;
export const MAX_TIMEOUT_MS = 120_000;
const ERROR_BODY_EXCERPT = 200;

/** Q-WHA-05: only idempotent verbs may be retried. */
const IDEMPOTENT_METHODS: WebhookMethod[] = ['GET', 'PUT', 'DELETE'];

export interface WebhookOutput {
  status: number;
  ok: boolean;
  responseBody: unknown;
  responseText: string;
  responseHeaders: Record<string, string>;
  durationMs: number;
  url: string;
  retries: number;
  truncated: boolean;
  error: string | null;
}

export interface WebhookDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** SSRF guard (spec §5): block loopback, link-local/metadata and private ranges. */
export function assertAllowedTarget(rawUrl: string, allowPrivateNetwork = false): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new WebhookActionError(`Invalid request URL: ${rawUrl}`, 'validation');
  }
  if (!['http:', 'https:'].includes(url.protocol))
    throw new WebhookActionError(`Unsupported URL protocol "${url.protocol}"`, 'validation');
  if (allowPrivateNetwork) return url;

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const blockedHosts = ['localhost', 'metadata.google.internal', 'metadata'];
  const isBlockedHost =
    blockedHosts.includes(host) ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host === '::1' ||
    host === '0.0.0.0';
  if (isBlockedHost)
    throw new WebhookActionError(
      `Blocked target "${url.hostname}": loopback/link-local/metadata hosts are denied by default ` +
        '(enable "allow private network" on the step to override)',
      'blocked_target'
    );

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    const isPrivate =
      a === 127 ||
      a === 10 ||
      (a === 169 && b === 254) || // includes 169.254.169.254 metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 0;
    if (isPrivate)
      throw new WebhookActionError(
        `Blocked target "${host}": private/link-local addresses are denied by default ` +
          '(enable "allow private network" on the step to override)',
        'blocked_target'
      );
  }
  const ipv6 = host.toLowerCase();
  if (ipv6 === '::1' || ipv6.startsWith('fe80:') || ipv6.startsWith('fc') || ipv6.startsWith('fd'))
    throw new WebhookActionError(
      `Blocked target "${host}": private/link-local addresses are denied by default`,
      'blocked_target'
    );

  return url;
}

export interface BuiltRequest {
  method: WebhookMethod;
  url: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  acceptStatuses: number[] | 'any';
  allowPrivateNetwork: boolean;
  retriesAllowed: boolean;
  /** Secrets to redact from any surfaced text. */
  secrets: string[];
}

function parseAcceptStatuses(raw: unknown): number[] | 'any' {
  if (raw === undefined || raw === null || raw === '') return [];
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.toLowerCase() === 'any') return 'any';
    const values = trimmed
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((entry) => Number(entry));
    if (values.some((value) => !Number.isInteger(value) || value < 100 || value > 599))
      throw new WebhookActionError(
        `acceptStatuses must be "any" or comma-separated HTTP codes, got "${trimmed}"`,
        'validation'
      );
    return values;
  }
  if (Array.isArray(raw)) return parseAcceptStatuses(raw.join(','));
  throw new WebhookActionError(
    'acceptStatuses must be "any" or a list of status codes',
    'validation'
  );
}

function buildAuth(auth: any, url: URL, headers: Record<string, string>, secrets: string[]): void {
  if (!auth) return;
  const type = String(auth.type ?? 'none').toLowerCase();
  if (type === 'none' || !type) return;

  if (type === 'basic') {
    const username = String(auth.username ?? '');
    const password = String(auth.password ?? '');
    if (!username) throw new WebhookActionError('Basic auth requires a username', 'validation');
    secrets.push(password, `${username}:${password}`);
    headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    return;
  }
  if (type === 'bearer') {
    const token = String(auth.token ?? auth.apiKey ?? '');
    if (!token) throw new WebhookActionError('Bearer auth requires a token', 'validation');
    secrets.push(token);
    headers.Authorization = `Bearer ${token}`;
    return;
  }
  if (type === 'api_key' || type === 'apikey') {
    const key = String(auth.apiKey ?? auth.token ?? '');
    if (!key) throw new WebhookActionError('API-key auth requires a key', 'validation');
    secrets.push(key);
    const name = String(auth.apiKeyName ?? 'X-API-Key');
    const placement = String(auth.in ?? auth.placement ?? 'header').toLowerCase();
    if (placement === 'query') url.searchParams.set(name, key);
    else headers[name] = key;
    return;
  }
  throw new WebhookActionError(
    `Unsupported auth type "${type}" — v1 supports none, basic, bearer and api_key (OAuth2 is backlog)`,
    'validation'
  );
}

export function buildRequest(rawMetadata: unknown, run: Record<string, unknown>): BuiltRequest {
  if (!rawMetadata || typeof rawMetadata !== 'object' || Array.isArray(rawMetadata))
    throw new WebhookActionError('Webhook action metadata must be an object', 'validation');

  // Text mode walks the whole metadata graph (url, headers, auth, form/raw body).
  const metadata = resolvePlaceholders(rawMetadata, run) as Record<string, any>;
  const method = String(metadata.method ?? 'GET').toUpperCase() as WebhookMethod;
  if (!(FIVE_VERBS as readonly string[]).includes(method))
    throw new WebhookActionError(
      `Unsupported HTTP method "${metadata.method}" — use GET, POST, PUT, PATCH or DELETE`,
      'validation'
    );

  const rawUrl = String(metadata.url ?? '').trim();
  if (!rawUrl) throw new WebhookActionError('Request URL is required', 'validation');
  const allowPrivateNetwork = Boolean(metadata.allowPrivateNetwork);
  const url = assertAllowedTarget(rawUrl, allowPrivateNetwork);

  // Static + templated query params.
  const query = metadata.query;
  if (query && typeof query === 'object')
    for (const [key, value] of Object.entries(query))
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));

  const headers: Record<string, string> = {};
  if (metadata.headers && typeof metadata.headers === 'object')
    for (const [key, value] of Object.entries(metadata.headers))
      if (value !== undefined && value !== null) headers[key] = String(value);

  const secrets: string[] = [];
  buildAuth(metadata.auth, url, headers, secrets);

  const bodyMode = String(
    metadata.bodyMode ?? (metadata.body === undefined ? 'none' : 'json')
  ).toLowerCase();
  let body: string | undefined;
  if (bodyMode !== 'none' && bodyMode !== '') {
    if (method === 'GET')
      throw new WebhookActionError('GET requests cannot carry a body', 'validation');
    if (bodyMode === 'json') {
      // JSON mode: serialise (if needed) -> parse -> resolve -> stringify, so a
      // substituted quote/backslash/newline can never break the body (#53).
      // `rawMetadata.body` is used deliberately: the text pass above would have
      // already flattened typed leaves.
      const payload = (rawMetadata as Record<string, any> | undefined)?.body;
      const serialized =
        typeof payload === 'string'
          ? payload
          : JSON.stringify(payload === undefined ? {} : payload);
      try {
        body = resolvePlaceholders(serialized, run, { mode: 'json' });
      } catch (error) {
        if (error instanceof PlaceholderError) {
          throw new WebhookActionError(
            `Body is not valid JSON — ${error.message} (send it as "raw" if it is not JSON)`,
            'validation'
          );
        }
        throw error;
      }
      if (!headers['Content-Type'] && !headers['content-type'])
        headers['Content-Type'] = 'application/json';
    } else if (bodyMode === 'form') {
      const payload = metadata.body;
      const params = new URLSearchParams();
      if (payload && typeof payload === 'object' && !Array.isArray(payload))
        for (const [key, value] of Object.entries(payload))
          if (value !== undefined && value !== null) params.set(key, String(value));
          else if (typeof payload === 'string')
            payload
              .split('&')
              .filter(Boolean)
              .forEach((pair) => {
                const [key, ...rest] = pair.split('=');
                if (key) params.set(key, rest.join('='));
              });
      body = params.toString();
      if (!headers['Content-Type'] && !headers['content-type'])
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (bodyMode === 'raw') {
      body =
        typeof metadata.body === 'string' ? metadata.body : JSON.stringify(metadata.body ?? '');
      if (!headers['Content-Type'] && !headers['content-type'])
        headers['Content-Type'] = 'text/plain; charset=utf-8';
    } else {
      throw new WebhookActionError(
        `Unsupported body mode "${bodyMode}" — use json, form or raw (multipart is backlog)`,
        'validation'
      );
    }
  }

  const timeoutMs = Math.min(
    Math.max(Number(metadata.timeoutMs ?? DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS, 1),
    MAX_TIMEOUT_MS
  );

  return {
    method,
    url: url.toString(),
    headers,
    body,
    timeoutMs,
    acceptStatuses: parseAcceptStatuses(metadata.acceptStatuses),
    allowPrivateNetwork,
    retriesAllowed: IDEMPOTENT_METHODS.includes(method),
    secrets: secrets.filter(Boolean),
  };
}

function redact(text: string, request: BuiltRequest): string {
  let output = text;
  for (const secret of request.secrets) output = output.split(secret).join('<redacted>');
  // Also hide api-key query values that may appear in echoed URLs.
  return output.replace(/([?&](?:api[_-]?key|access_token|token)=)[^&]+/gi, '$1<redacted>');
}

export function safeUrl(url: string, request: BuiltRequest): string {
  return redact(url, request);
}

function isAllowedStatus(status: number, accept: number[] | 'any'): boolean {
  if (accept === 'any') return true;
  if (accept.length) return accept.includes(status);
  return status >= 200 && status < 300;
}

async function readCapped(response: Response): Promise<{ text: string; truncated: boolean }> {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    return { text: text.slice(0, RESPONSE_MAX_BYTES), truncated: text.length > RESPONSE_MAX_BYTES };
  }
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      bytes += value.byteLength;
      if (bytes > RESPONSE_MAX_BYTES) {
        truncated = true;
        await reader.cancel().catch(() => {});
        break;
      }
      chunks.push(value);
    }
  }
  return {
    text: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8'),
    truncated,
  };
}

function headerObject(response: Response): Record<string, string> {
  const out: Record<string, string> = {};
  const anyHeaders = response.headers as any;
  if (typeof anyHeaders?.forEach === 'function')
    anyHeaders.forEach((value: string, key: string) => {
      out[key.toLowerCase()] = value;
    });
  else if (anyHeaders && typeof anyHeaders.get === 'function')
    for (const key of ['content-type']) {
      const value = anyHeaders.get(key);
      if (value) out[key] = value;
    }
  return out;
}

const sameHost = (a: string, b: string) => {
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return false;
  }
};

async function dispatchOnce(
  request: BuiltRequest,
  fetchImpl: typeof fetch
): Promise<{ response: Response; finalUrl: string }> {
  let currentUrl = request.url;
  let headers = { ...request.headers };
  let redirects = 0;

  for (;;) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(currentUrl, {
        method: request.method,
        headers,
        ...(request.body !== undefined ? { body: request.body } : {}),
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (error) {
      const name = (error as Error)?.name;
      if (name === 'AbortError' || name === 'TimeoutError')
        throw new WebhookActionError(
          `Request timed out after ${request.timeoutMs}ms`,
          'timeout',
          true
        );
      throw new WebhookActionError(
        redact(`Network error: ${(error as Error)?.message ?? 'request failed'}`, request),
        'network',
        true
      );
    } finally {
      clearTimeout(timer);
    }

    const location = response.headers?.get?.('location');
    if (response.status >= 300 && response.status < 400 && location) {
      redirects += 1;
      if (redirects > MAX_REDIRECTS)
        throw new WebhookActionError(
          `Too many redirects (>${MAX_REDIRECTS})`,
          'too_many_redirects'
        );
      const next = new URL(location, currentUrl).toString();
      assertAllowedTarget(next, request.allowPrivateNetwork);
      // Never forward Authorization (or any credential header) across hosts.
      if (!sameHost(currentUrl, next))
        headers = Object.fromEntries(
          Object.entries(headers).filter(([key]) => key.toLowerCase() !== 'authorization')
        );
      currentUrl = next;
      continue;
    }
    return { response, finalUrl: currentUrl };
  }
}

/**
 * Execute the outbound request. Q-WHA-05 retries live here (so the caller's
 * generic retry wrapper must not double them): idempotent verbs retry 5xx and
 * timeouts with bounded backoff; POST/PATCH fail fast; 4xx never retries.
 */
export async function runWebhookAction(
  rawMetadata: unknown,
  runMetadata: Record<string, unknown> = {},
  deps: WebhookDeps = {}
): Promise<WebhookOutput> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;

  const request = buildRequest(rawMetadata, runMetadata);
  const maxAttempts = request.retriesAllowed ? 3 : 1;
  const started = now();
  let retries = 0;
  let lastError: WebhookActionError | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const { response, finalUrl } = await dispatchOnce(request, fetchImpl);
      const { text, truncated } = await readCapped(response);
      const ok = isAllowedStatus(response.status, request.acceptStatuses);
      let responseBody: unknown = null;
      const contentType = response.headers?.get?.('content-type') || '';
      if (/json/i.test(contentType) || (!contentType && /^\s*[[{]/.test(text))) {
        try {
          responseBody = text ? JSON.parse(text) : null;
        } catch {
          responseBody = null; // never crash on a bad JSON body
        }
      }

      if (!ok) {
        const retryable = request.retriesAllowed && response.status >= 500;
        const bodyExcerpt = redact(text.slice(0, ERROR_BODY_EXCERPT), request);
        if (retryable && attempt < maxAttempts) {
          retries += 1;
          await sleep(250 * 2 ** (attempt - 1));
          continue;
        }
        throw new WebhookActionError(
          redact(
            `HTTP ${response.status} from ${safeUrl(finalUrl, request)}` +
              (bodyExcerpt ? `: ${bodyExcerpt}` : ''),
            request
          ),
          'http_status',
          retryable,
          response.status
        );
      }

      return {
        status: response.status,
        ok: true,
        responseBody,
        responseText: redact(text, request),
        responseHeaders: headerObject(response),
        durationMs: now() - started,
        url: safeUrl(finalUrl, request),
        retries,
        truncated,
        error: null,
      };
    } catch (error) {
      const classified =
        error instanceof WebhookActionError
          ? error
          : new WebhookActionError(
              redact((error as Error)?.message ?? 'Unknown request error', request),
              'network',
              false
            );
      lastError = classified;
      if (classified.code === 'http_status' && (classified.status ?? 0) >= 400) throw classified;
      if (classified.retryable && request.retriesAllowed && attempt < maxAttempts) {
        retries += 1;
        await sleep(250 * 2 ** (attempt - 1));
        continue;
      }
      throw classified;
    }
  }

  throw lastError ?? new WebhookActionError('Webhook request failed', 'network');
}
