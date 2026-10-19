import {
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  PublicKey,
  sendAndConfirmTransaction,
  Connection,
} from '@solana/web3.js';
// bs58@6 is ESM-only; a plain require() yields the module namespace
// ({ default: { encode, decode } }) in CommonJS builds.
const bs58Module = require('bs58');
const base58 = bs58Module?.default ?? bs58Module;

const connection = new Connection('https://api.devnet.solana.com', 'finalized');

/**
 * Resolve the Solana keypair secret.
 * SOLANA_PRIVATE_KEY is the documented name; SOL_PRIVATE_KEY is the legacy
 * name that earlier code (and its docs) disagreed about. Support both so a
 * mismatch can no longer silently disable the action.
 */
export const getSolanaPrivateKey = (): string | undefined =>
  process.env.SOLANA_PRIVATE_KEY || process.env.SOL_PRIVATE_KEY;

export async function sendSol(address: string, amount: string) {
  const secret = getSolanaPrivateKey();
  if (!secret) {
    throw new Error('SOLANA_PRIVATE_KEY is not set');
  }

  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    throw new Error(`Invalid Solana amount: ${amount}`);
  }

  const keypair = Keypair.fromSecretKey(base58.decode(secret));
  console.log(keypair.publicKey);

  const transferTransaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: new PublicKey(address),
      // Lamports are an integer; a fractional value is rejected by web3.js.
      lamports: Math.round(parsedAmount * LAMPORTS_PER_SOL),
    })
  );

  try {
    await sendAndConfirmTransaction(connection, transferTransaction, [keypair]);
    console.log('Solana Sent!');
  } catch (error) {
    // Never report a failed on-chain transfer as success: the worker's retry
    // and run-failure handling depend on this rejection.
    console.error("Couldn't send solana!", error);
    throw error;
  }
}
