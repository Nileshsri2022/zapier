import { PublicKey } from '@solana/web3.js';

/**
 * A3 — Solana action, READ-ONLY v1 (docs/ask-matt/actions/solana.md, grilled
 * round 13).
 *
 * Q-SOL-01: only the read operations ship — getBalance (O1),
 * getTokenAccounts (O2), getAccount (O3), getLatestBlockhash / slot / version
 * (O8). send-SOL, send-SPL, raw transactions and program instructions are
 * BACKLOG and gated behind an external-signer security review.
 *
 * Q-SOL-03: **no secret keys are ever read, stored or handled** — this module
 * has no keypair, signing or key-environment code at all. Only RPC config is
 * accepted (network + optional user RPC URL, the latter never logged).
 *
 * Q-SOL-05: commitment defaults to `confirmed` and is echoed in read output.
 * Precision: lamports/uiAmount are emitted as decimal STRINGS — never floats.
 */

export type SolanaNetwork = 'mainnet-beta' | 'devnet' | 'testnet';

export type SolanaErrorCode =
  | 'validation'
  | 'invalid_address'
  | 'account_not_found'
  | 'rpc_rate_limited'
  | 'rpc_unavailable'
  | 'rpc_error';

export class SolanaActionError extends Error {
  constructor(
    message: string,
    public readonly code: SolanaErrorCode,
    public readonly retryable = false
  ) {
    super(message);
    this.name = 'SolanaActionError';
  }
}

export type SolanaOperation =
  | 'getBalance'
  | 'getTokenAccounts'
  | 'getAccount'
  | 'getLatestBlockhash'
  | 'getSlot'
  | 'getVersion';

export const DEFAULT_RPC_URLS: Record<SolanaNetwork, string> = {
  'mainnet-beta': 'https://api.mainnet-beta.solana.com',
  devnet: 'https://api.devnet.solana.com',
  testnet: 'https://api.testnet.solana.com',
};

export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const DEFAULT_COMMITMENT = 'confirmed' as const;

const NETWORKS: SolanaNetwork[] = ['mainnet-beta', 'devnet', 'testnet'];

export interface SolanaConnectionConfig {
  network: SolanaNetwork;
  rpcUrl: string;
  /** True when the URL came from user config — never log it. */
  isOverride: boolean;
}

export function resolveConnection(metadata: Record<string, unknown>): SolanaConnectionConfig {
  const rawNetwork = String(metadata.network ?? '').trim();
  const network = (NETWORKS as string[]).includes(rawNetwork)
    ? (rawNetwork as SolanaNetwork)
    : rawNetwork
      ? ((): never => {
          throw new SolanaActionError(
            `Unsupported network "${rawNetwork}" — use mainnet-beta, devnet or testnet`,
            'validation'
          );
        })()
      : 'mainnet-beta';
  const override = String(metadata.rpcUrl ?? '').trim();
  if (override && !/^https?:\/\//i.test(override))
    throw new SolanaActionError('Custom RPC URL must start with http:// or https://', 'validation');
  return { network, rpcUrl: override || DEFAULT_RPC_URLS[network], isOverride: Boolean(override) };
}

/** Q-SOL-01 pre-call validation: base58 public keys only. */
export function validateAddress(value: unknown, field = 'address'): string {
  const address = String(value ?? '').trim();
  if (!address) throw new SolanaActionError(`${field} is required`, 'validation');
  try {
    new PublicKey(address);
  } catch {
    throw new SolanaActionError(
      `Invalid Solana address for ${field}: ${address}`,
      'invalid_address'
    );
  }
  return address;
}

const LAMPORTS_PER_SOL = 1_000_000_000n;

/** Exact decimal string — integer math only, no IEEE floats (spec §4). */
export function lamportsToSolString(lamports: string | number | bigint): string {
  let value: bigint;
  try {
    value = BigInt(String(lamports));
  } catch {
    return '0';
  }
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / LAMPORTS_PER_SOL;
  const fraction = (abs % LAMPORTS_PER_SOL).toString().padStart(9, '0').replace(/0+$/, '');
  const text = fraction ? `${whole}.${fraction}` : `${whole}`;
  return negative ? `-${text}` : text;
}

/**
 * Map base units to a decimal string for a given number of decimals — used for
 * SPL token uiAmount without touching floats (spec §4 precision rule).
 */
export function toDecimalString(amount: string | bigint, decimals: number): string {
  const value = BigInt(String(amount));
  if (decimals <= 0) return value.toString();
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

interface RpcResponse {
  result?: unknown;
  error?: { code?: number; message?: string };
}

async function rpcCall(
  config: SolanaConnectionConfig,
  method: string,
  params: unknown[],
  fetchImpl: typeof fetch,
  redact: (text: string) => string
): Promise<any> {
  let response: Response;
  try {
    response = await fetchImpl(config.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
  } catch (error) {
    // Override URLs may embed credentials — redact before surfacing.
    throw new SolanaActionError(
      redact(`Solana RPC unavailable: ${(error as Error)?.message ?? 'network error'}`),
      'rpc_unavailable',
      true
    );
  }

  if (response.status === 429)
    throw new SolanaActionError(
      'Solana RPC rate limit hit (HTTP 429). The public endpoint is shared — add your own RPC URL ' +
        'to this connection for reliable throughput.',
      'rpc_rate_limited',
      true
    );
  if (response.status >= 500)
    throw new SolanaActionError(
      `Solana RPC is temporarily unavailable (HTTP ${response.status})`,
      'rpc_unavailable',
      true
    );

  const body = (await response.json().catch(() => ({}))) as RpcResponse;
  if (!response.ok || body.error)
    throw new SolanaActionError(
      redact(`Solana RPC error (${method}): ${body.error?.message ?? `HTTP ${response.status}`}`),
      'rpc_error'
    );
  return body.result;
}

function parseMetadata(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new SolanaActionError('Solana action metadata must be an object', 'validation');
  return raw as Record<string, unknown>;
}

function redactor(config: SolanaConnectionConfig) {
  return (text: string) => {
    if (!config.isOverride) return text;
    let out = text.split(config.rpcUrl).join('<custom-rpc>');
    try {
      const url = new URL(config.rpcUrl);
      if (url.username) out = out.split(url.username).join('<redacted>');
      if (url.password) out = out.split(url.password).join('<redacted>');
      for (const value of url.searchParams.values())
        if (value) out = out.split(value).join('<redacted>');
    } catch {
      /* noop */
    }
    return out;
  };
}

export interface SolanaActionOutput {
  operation: SolanaOperation;
  network: SolanaNetwork;
  commitment: typeof DEFAULT_COMMITMENT;
  slot?: number;
  address?: string;
  owner?: string;
  lamports?: string;
  sol?: string;
  accounts?: {
    mint: string;
    amount: string;
    decimals: number;
    uiAmount: string;
    tokenAccount: string;
  }[];
  executable?: boolean;
  dataEncoding?: 'base64';
  data?: string;
  blockhash?: string;
  lastValidBlockHeight?: number;
  version?: unknown;
}

export async function runSolanaAction(
  rawMetadata: unknown,
  fetchImpl: typeof fetch = fetch
): Promise<SolanaActionOutput> {
  const metadata = parseMetadata(rawMetadata);
  const operation = String(metadata.operation ?? '').trim();
  const config = resolveConnection(metadata);
  const redact = redactor(config);
  const commitment = DEFAULT_COMMITMENT;

  const base = { network: config.network, commitment } as const;

  if (operation === 'getVersion') {
    const version = await rpcCall(config, 'getVersion', [], fetchImpl, redact);
    return { ...base, operation: 'getVersion', version };
  }

  if (operation === 'getSlot') {
    const slot = await rpcCall(config, 'getSlot', [{ commitment }], fetchImpl, redact);
    return { ...base, operation: 'getSlot', slot: Number(slot) };
  }

  if (operation === 'getLatestBlockhash') {
    const result = await rpcCall(config, 'getLatestBlockhash', [{ commitment }], fetchImpl, redact);
    return {
      ...base,
      operation: 'getLatestBlockhash',
      blockhash: String(result?.value?.blockhash ?? ''),
      lastValidBlockHeight: Number(
        result?.context?.slot ?? result?.value?.lastValidBlockHeight ?? 0
      ),
    };
  }

  if (operation === 'getBalance') {
    const address = validateAddress(metadata.address);
    const result = await rpcCall(
      config,
      'getBalance',
      [address, { commitment }],
      fetchImpl,
      redact
    );
    const lamports = String(result?.value ?? 0);
    return {
      ...base,
      operation: 'getBalance',
      address,
      lamports,
      sol: lamportsToSolString(lamports),
      slot: Number(result?.context?.slot ?? 0),
    };
  }

  if (operation === 'getTokenAccounts') {
    const owner = validateAddress(metadata.owner ?? metadata.address, 'owner');
    const mint = metadata.mint ? validateAddress(metadata.mint, 'mint') : '';
    const filter = mint ? { mint } : { programId: TOKEN_PROGRAM_ID };
    const result = await rpcCall(
      config,
      'getTokenAccountsByOwner',
      [owner, filter, { encoding: 'jsonParsed', commitment }],
      fetchImpl,
      redact
    );
    const accounts = (Array.isArray(result?.value) ? result.value : []).map((entry: any) => {
      const info = entry?.account?.data?.parsed?.info ?? {};
      const tokenAmount = info.tokenAmount ?? {};
      const decimals = Number(tokenAmount.decimals ?? 0);
      const amount = String(tokenAmount.amount ?? '0');
      return {
        mint: String(info.mint ?? ''),
        amount,
        decimals,
        // Provider uiAmount is a float; recompute exactly from base units.
        uiAmount: toDecimalString(amount, decimals),
        tokenAccount: String(entry?.pubkey ?? ''),
      };
    });
    return {
      ...base,
      operation: 'getTokenAccounts',
      address: owner,
      accounts,
      slot: Number(result?.context?.slot ?? 0),
    };
  }

  if (operation === 'getAccount') {
    const address = validateAddress(metadata.address);
    const result = await rpcCall(
      config,
      'getAccountInfo',
      [address, { encoding: 'base64', commitment }],
      fetchImpl,
      redact
    );
    const value = result?.value;
    if (!value)
      throw new SolanaActionError(
        `account_not_found: no account exists at ${address} on ${config.network}`,
        'account_not_found'
      );
    return {
      ...base,
      operation: 'getAccount',
      address,
      owner: String(value.owner ?? ''),
      lamports: String(value.lamports ?? 0),
      sol: lamportsToSolString(value.lamports ?? 0),
      executable: Boolean(value.executable),
      dataEncoding: 'base64',
      data: Array.isArray(value.data) ? String(value.data[0] ?? '') : '',
      slot: Number(result?.context?.slot ?? 0),
    };
  }

  throw new SolanaActionError(
    operation
      ? `Unsupported Solana operation "${operation}" — v1 supports getBalance, getTokenAccounts, getAccount, getLatestBlockhash, getSlot and getVersion (send operations are backlog)`
      : 'Solana operation is required',
    'validation'
  );
}
