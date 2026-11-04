/** Every keypair a test makes signs its own prepare, like the launch form does. A wallet the test does not hold stays unsigned. */
import { Keypair } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';
const held = new Map();
const generate = Keypair.generate.bind(Keypair);
Keypair.generate = () => { const k = generate(); held.set(k.publicKey.toBase58(), k); return k; };
export const hold = (k) => { held.set(k.publicKey.toBase58(), k); return k; };
export const withProof = (body) => {
  const k = held.get(body?.wallet);
  if (!k || body.signature || body.noProof) return body;
  const ts = Date.now();
  return { ...body, ts, signature: bs58.encode(ed25519.sign(new TextEncoder().encode(`ipo launch\nwallet: ${body.wallet}\ntime: ${ts}`), k.secretKey.slice(0, 32))) };
};
