import { sendSol } from '../src/sendSolana';

/**
 * Solana action regressions.
 *
 * 1. sendSolana loads bs58 v6 (an ESM-only package) with require(). Node
 *    exposes that module as { default: { decode } }, so `base58.decode` was
 *    undefined and every Solana action threw before building a transfer.
 * 2. sendSol caught every tx error and returned normally, so the worker's
 *    retry/failure path never saw a failed transfer and marked the run
 *    completed.
 */

jest.mock('@solana/web3.js', () => {
  const actual = jest.requireActual('@solana/web3.js');
  return {
    ...actual,
    Connection: jest.fn().mockImplementation(() => ({})),
    Keypair: {
      fromSecretKey: jest.fn().mockReturnValue({ publicKey: 'mocked-public-key' }),
    },
    SystemProgram: { transfer: jest.fn().mockReturnValue({ instructions: [] }) },
    sendAndConfirmTransaction: jest.fn(),
  };
});

const { sendAndConfirmTransaction } = require('@solana/web3.js');

const VALID_ADDRESS = '11111111111111111111111111111111';
const VALID_SECRET = '11111111111111111111111111111111';

describe('sendSol', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.SOLANA_PRIVATE_KEY = VALID_SECRET;
    delete process.env.SOL_PRIVATE_KEY;
    (sendAndConfirmTransaction as jest.Mock).mockReset();
    (sendAndConfirmTransaction as jest.Mock).mockResolvedValue('signature');
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('sends a transfer without the bs58 ESM interop crash', async () => {
    await expect(sendSol(VALID_ADDRESS, '0.1')).resolves.toBeUndefined();
    expect(sendAndConfirmTransaction).toHaveBeenCalledTimes(1);
  });

  it('propagates a failed transfer so the worker marks the run failed', async () => {
    (sendAndConfirmTransaction as jest.Mock).mockRejectedValue(new Error('tx boom'));

    await expect(sendSol(VALID_ADDRESS, '0.1')).rejects.toThrow('tx boom');
  });
});
