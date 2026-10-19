import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { AiConnectionError } from './errors';

export type CapabilityProfileId = 'chat_json_schema' | 'chat_json_object' | 'chat_prompt_json';
/** Reviewed baseline protocol profiles, not provider capability auto-detection. */
export const CAPABILITY_PROFILES: readonly CapabilityProfileId[] = [
  'chat_json_schema',
  'chat_json_object',
  'chat_prompt_json',
];

function blocked(): never {
  throw new AiConnectionError(
    'ENDPOINT_BLOCKED',
    'AI endpoint is not permitted by outbound policy'
  );
}

export function parseAllowedHosts(value: string | undefined): readonly string[] {
  if (!value?.trim()) return [];
  const hosts = value.split(',').map((host) => host.trim().toLowerCase());
  if (hosts.some((host) => !validHostname(host))) {
    throw new AiConnectionError(
      'CONFIGURATION',
      'AI compatible allowed hosts must be exact public DNS hostnames'
    );
  }
  return [...new Set(hosts)];
}

function validHostname(host: string): boolean {
  return (
    host.length <= 253 &&
    !isIP(host) &&
    host.includes('.') &&
    host.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) &&
    !/(^|\.)(localhost|local|internal|test|invalid)$/.test(host)
  );
}

export function normalizeBaseUrl(raw: string, allowedHosts: readonly string[]): string {
  try {
    if (
      raw.length > 2048 ||
      raw !== raw.trim() ||
      /[\s\\]/.test(raw) ||
      Array.from(raw).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    )
      return blocked();
    const url = new URL(raw);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      raw.includes('?') ||
      raw.includes('#') ||
      (url.port && url.port !== '443') ||
      !validHostname(url.hostname) ||
      !allowedHosts.includes(url.hostname)
    )
      return blocked();
    // Keep URL composition unambiguous; do not accept encoded separators, traversal, or full endpoints.
    const originalPath = raw.replace(/^https:\/\/[^/]+/i, '').replace(/\/+$/, '');
    if (
      originalPath &&
      (!/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(originalPath) ||
        /\/(chat|completions|responses)(\/|$)/i.test(originalPath))
    )
      return blocked();
    url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString().replace(/\/$/, '');
  } catch {
    return blocked();
  }
}

export interface ResolvedAddress {
  address: string;
  family: number;
}
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export function isPublicAddress(value: string): boolean {
  try {
    const address = ipaddr.parse(value);
    // IPv4-mapped IPv6, transition/tunnel ranges, documentation and reserved networks are rejected.
    if (address.kind() === 'ipv6' && address.match(ipaddr.parse('3fff::'), 20)) return false;
    return (
      address.range() === 'unicast' &&
      (address.kind() === 'ipv4' || address.match(ipaddr.parse('2000::'), 3))
    );
  } catch {
    return false;
  }
}

export async function resolvePublicAddress(
  hostname: string,
  resolver: Resolver = (name) => lookup(name, { all: true, verbatim: true })
): Promise<ResolvedAddress> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Bound DNS even for connection CRUD; timed-out resolutions are never used for dispatch.
    const addresses = await Promise.race([
      resolver(hostname),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('DNS timeout')), 5000);
      }),
    ]);
    if (
      !addresses.length ||
      addresses.some(
        (entry) => !isPublicAddress(entry.address) || isIP(entry.address) !== entry.family
      )
    )
      return blocked();
    return addresses[0]!;
  } catch {
    return blocked();
  } finally {
    if (timer) clearTimeout(timer);
  }
}
