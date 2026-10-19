import { API_URL } from './config';

/** Cookie-authenticated, no credential/token persistence, no automatic retry of paid requests. */
export async function aiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  if (init.method && !['GET', 'HEAD'].includes(init.method)) {
    const csrf = await fetch(`${API_URL}/api/ai/csrf`, {
      credentials: 'include',
      cache: 'no-store',
    });
    if (!csrf.ok) throw new Error('Sign in again to manage or test AI steps');
    const data = await csrf.json();
    headers.set('X-AI-CSRF', data.csrfToken);
  }
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    credentials: 'include',
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(typeof data.message === 'string' ? data.message : 'AI request failed');
  return data as T;
}
export interface AiConnectionView {
  id: string;
  name: string;
  baseUrl: string;
  capabilityProfileId: string;
  configured: boolean;
  revoked: boolean;
}
export interface AiDiscovery {
  defaultProvider: string;
  providers: {
    id: string;
    models: string[];
    defaultModel: string;
    configured: boolean;
    connectionRequired: boolean;
  }[];
  limits: { maxInputChars: number; maxOutputTokens: number };
}
export interface AiPreview {
  output: string;
  fields: Record<string, unknown>;
  provider: string;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  latencyMs: number;
  truncated: boolean;
}
