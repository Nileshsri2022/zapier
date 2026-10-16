import {
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  PublicKey,
  sendAndConfirmTransaction,
  Connection,
} from '@solana/web3.js';
const base58 = require('bs58');

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
  const keypair = Keypair.fromSecretKey(base58.decode(getSolanaPrivateKey() ?? ''));
  console.log(keypair.publicKey);

  const transferTransaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: new PublicKey(address),
      lamports: parseFloat(amount) * LAMPORTS_PER_SOL,
    })
  );

  try {
    await sendAndConfirmTransaction(connection, transferTransaction, [keypair]);
    console.log('Solana Sent!');
  } catch (error) {
    console.log("Couldn't send solana!", error);
  }
}
