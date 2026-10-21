import {
  DEFAULT_RPC_URLS,
  SolanaActionError,
  lamportsToSolString,
  resolveConnection,
  runSolanaAction,
  toDecimalString,
  validateAddress,
} from '../src/solanaRead';

/**
 * A3 spec acceptance (docs/ask-matt/actions/solana.md, grilled round 13):
 * Q-SOL-01 read-only ops O1–O3/O8 · Q-SOL-02 network per connection ·
 * Q-SOL-03 no keys anywhere · Q-SOL-04 public RPC + override ·
 * Q-SOL-05 commitment confirmed · decimal-string precision.
 */

const ADDRESS = '11111111111111111111111111111111';
const OWNER = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const rpc = (result: unknown, status = 200) =>
  jest.fn(async (_url: string, _init?: any) => ({
    ok: status < 400,
    status,
    json: async () => ({ jsonrpc: '2.0', result }),
    text: async () => JSON.stringify({ result }),
  })) as unknown as typeof fetch;

const calls = (fetchImpl: typeof fetch) => (fetchImpl as unknown as jest.Mock).mock.calls;

describe('Q-SOL-03: the action has zero key-handling paths', () => {
  it('module source contains no keypair/signing/secret-key code', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, '../src/solanaRead.ts'), 'utf8');
    for (const forbidden of [
      'Keypair',
      'sendAndConfirmTransaction',
      'fromSecretKey',
      'PRIVATE_KEY',
      'privateKey',
      'signTransaction',
      'SystemProgram',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('refuses send-type operations as validation errors (backlog, not silent)', async () => {
    for (const operation of ['sendSol', 'sendToken', 'sendRawTransaction', 'stake']) {
      await expect(runSolanaAction({ operation, address: ADDRESS }, rpc({}))).rejects.toMatchObject(
        { code: 'validation' }
      );
    }
  });
});

describe('Q-SOL-02/Q-SOL-04 connection resolution', () => {
  it('defaults to mainnet public RPC and accepts an override', () => {
    expect(resolveConnection({})).toEqual({
      network: 'mainnet-beta',
      rpcUrl: DEFAULT_RPC_URLS['mainnet-beta'],
      isOverride: false,
    });
    expect(resolveConnection({ network: 'devnet' }).rpcUrl).toBe(DEFAULT_RPC_URLS.devnet);
    const override = resolveConnection({
      network: 'devnet',
      rpcUrl: 'https://rpc.example.com/?api-key=SECRET',
    });
    expect(override.rpcUrl).toContain('SECRET');
    expect(override.isOverride).toBe(true);
  });

  it('rejects unknown networks and non-http RPC URLs', () => {
    expect(() => resolveConnection({ network: 'moonnet' })).toThrow(
      expect.objectContaining({ code: 'validation' })
    );
    expect(() => resolveConnection({ rpcUrl: 'ftp://bad' })).toThrow(
      expect.objectContaining({ code: 'validation' })
    );
  });

  it('redacts a custom RPC credential from surfaced RPC errors', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('connect ECONNREFUSED https://rpc.example.com/?api-key=SECRET');
    }) as unknown as typeof fetch;
    const error = await runSolanaAction(
      { operation: 'getSlot', rpcUrl: 'https://rpc.example.com/?api-key=SECRET' },
      fetchImpl
    ).then(
      () => null,
      (rejection: SolanaActionError) => rejection
    );
    expect(error).toBeInstanceOf(SolanaActionError);
    expect(error!.code).toBe('rpc_unavailable');
    expect(error!.message).not.toContain('SECRET');
    expect(error!.message).toContain('<custom-rpc>');
  });
});

describe('O1 getBalance (§4 contract, no floats)', () => {
  it('returns lamports as a string plus exact sol decimal', async () => {
    const fetchImpl = rpc({ context: { slot: 250123456 }, value: 123456789 });
    const out = await runSolanaAction({ operation: 'getBalance', address: ADDRESS }, fetchImpl);
    expect(out).toEqual({
      operation: 'getBalance',
      network: 'mainnet-beta',
      commitment: 'confirmed',
      address: ADDRESS,
      lamports: '123456789',
      sol: '0.123456789',
      slot: 250123456,
    });
    const [url, init] = calls(fetchImpl)[0] as [string, any];
    expect(url).toBe(DEFAULT_RPC_URLS['mainnet-beta']);
    const body = JSON.parse(init.body);
    expect(body.method).toBe('getBalance');
    expect(body.params).toEqual([ADDRESS, { commitment: 'confirmed' }]);
  });

  it('keeps precision for large balances (no float drift)', () => {
    expect(lamportsToSolString('123456789012345678')).toBe('123456789.012345678');
    expect(lamportsToSolString(1_000_000_000n)).toBe('1');
    expect(lamportsToSolString('1000000001')).toBe('1.000000001');
    expect(lamportsToSolString(0)).toBe('0');
    expect(toDecimalString('12500000', 6)).toBe('12.5');
    expect(toDecimalString('1', 9)).toBe('0.000000001');
  });
});

describe('O2 getTokenAccounts', () => {
  it('filters by mint when given and recomputes uiAmount exactly', async () => {
    const fetchImpl = rpc({
      context: { slot: 250123456 },
      value: [
        {
          pubkey: '7bSPtokenAccount',
          account: {
            data: {
              parsed: {
                info: {
                  mint: MINT,
                  tokenAmount: { amount: '12500000', decimals: 6, uiAmount: 12.5 },
                },
              },
            },
          },
        },
      ],
    });
    const out = await runSolanaAction(
      { operation: 'getTokenAccounts', owner: OWNER, mint: MINT },
      fetchImpl
    );
    expect(out.operation).toBe('getTokenAccounts');
    expect(out.accounts).toEqual([
      { mint: MINT, amount: '12500000', decimals: 6, uiAmount: '12.5', tokenAccount: '7bSPtokenAccount' },
    ]);
    expect(out.slot).toBe(250123456);
    const body = JSON.parse((calls(fetchImpl)[0] as [string, any])[1].body);
    expect(body.method).toBe('getTokenAccountsByOwner');
    expect(body.params[1]).toEqual({ mint: MINT });
  });

  it('uses the token program filter when no mint is specified', async () => {
    const fetchImpl = rpc({ context: { slot: 1 }, value: [] });
    await runSolanaAction({ operation: 'getTokenAccounts', owner: OWNER }, fetchImpl);
    const body = JSON.parse((calls(fetchImpl)[0] as [string, any])[1].body);
    expect(body.params[1]).toEqual({ programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' });
  });
});

describe('O3 getAccount and O8 chain reads', () => {
  it('returns base64 data and decodes the basics', async () => {
    const fetchImpl = rpc({
      context: { slot: 250123456 },
      value: {
        lamports: 1000000,
        owner: '11111111111111111111111111111111',
        executable: false,
        data: ['AQID', 'base64'],
      },
    });
    const out = await runSolanaAction({ operation: 'getAccount', address: ADDRESS }, fetchImpl);
    expect(out).toMatchObject({
      operation: 'getAccount',
      address: ADDRESS,
      lamports: '1000000',
      sol: '0.001',
      owner: '11111111111111111111111111111111',
      executable: false,
      dataEncoding: 'base64',
      data: 'AQID',
      slot: 250123456,
    });
  });

  it('account_not_found is a classified error, not empty success', async () => {
    const fetchImpl = rpc({ context: { slot: 1 }, value: null });
    await expect(
      runSolanaAction({ operation: 'getAccount', address: ADDRESS }, fetchImpl)
    ).rejects.toMatchObject({ code: 'account_not_found' });
  });

  it('exposes blockhash, slot and version', async () => {
    const blockhash = rpc({
      context: { slot: 250123456 },
      value: { blockhash: 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N', lastValidBlockHeight: 250123460 },
    });
    await expect(
      runSolanaAction({ operation: 'getLatestBlockhash' }, blockhash)
    ).resolves.toMatchObject({
      operation: 'getLatestBlockhash',
      blockhash: 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N',
      lastValidBlockHeight: 250123456,
    });

    await expect(runSolanaAction({ operation: 'getSlot' }, rpc(250123456))).resolves.toMatchObject({
      operation: 'getSlot',
      slot: 250123456,
    });

    await expect(
      runSolanaAction({ operation: 'getVersion' }, rpc({ 'solana-core': '1.18.0' }))
    ).resolves.toMatchObject({ operation: 'getVersion', version: { 'solana-core': '1.18.0' } });
  });
});

describe('validation and RPC error classes', () => {
  it('rejects invalid addresses before any RPC call', async () => {
    const fetchImpl = rpc({});
    for (const address of ['', 'not-a-key', '0OIl']) {
      await expect(
        runSolanaAction({ operation: 'getBalance', address }, fetchImpl)
      ).rejects.toMatchObject({ code: expect.any(String) });
    }
    expect(validateAddress(ADDRESS)).toBe(ADDRESS);
    expect(() => validateAddress('nope')).toThrow(SolanaActionError);
    expect(calls(fetchImpl)).toHaveLength(0);
  });

  it('classifies 429 as retryable rpc_rate_limited with an override hint', async () => {
    const fetchImpl = rpc({}, 429);
    await expect(
      runSolanaAction({ operation: 'getSlot' }, fetchImpl)
    ).rejects.toMatchObject({ code: 'rpc_rate_limited', retryable: true });
    await runSolanaAction({ operation: 'getSlot' }, fetchImpl).catch((error: SolanaActionError) => {
      expect(error.message).toContain('add your own RPC URL');
    });
  });

  it('classifies 5xx as retryable and JSON-RPC errors as non-retryable', async () => {
    await expect(
      runSolanaAction({ operation: 'getSlot' }, rpc({}, 503))
    ).rejects.toMatchObject({ code: 'rpc_unavailable', retryable: true });

    const rpcError = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ error: { code: -32602, message: 'Invalid param' } }),
    })) as unknown as typeof fetch;
    await expect(
      runSolanaAction({ operation: 'getSlot' }, rpcError)
    ).rejects.toMatchObject({ code: 'rpc_error', retryable: false });
  });
});
