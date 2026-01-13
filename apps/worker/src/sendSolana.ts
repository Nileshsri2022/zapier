import { Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction, PublicKey, sendAndConfirmTransaction, Connection } from "@solana/web3.js";
const base58 = require("bs58");

const connection = new Connection("https://api.mainnet-beta.solana.com", "finalized");

export async function sendSol(address: string, amount: string)  {
    const keypair = Keypair.fromSecretKey(base58.decode((process.env.SOL_PRIVATE_KEY ?? "")));
    console.log(keypair.publicKey);

    const transferTransaction = new Transaction().add(
        SystemProgram.transfer({
            fromPubkey: keypair.publicKey,
            toPubkey: new PublicKey(address),
            lamports: parseFloat(amount) * LAMPORTS_PER_SOL
        })
    )

    try {
        await sendAndConfirmTransaction(connection, transferTransaction, [keypair]);
        console.log("Solana Sent!");
    } catch (error) {
        console.log("Couldn't send solana!", error)
    }
}

