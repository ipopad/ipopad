/**
 * The creator's share of the curve fee on a coin set to creator rewards (operator, 4 Nov 2026: collectable any time, the rest sent at migration).
 * Meteora only lets the creator's own wallet claim a creator share, so these coins use curves that give the creator 0% on chain: the platform's
 * claim holds the share, and the platform pays it. One transaction claims exactly what is owed and sends it on, so a payment can never come from
 * anything but the coin's own fees. Ledger-first: the signature is written before the send, and the graduator waits for its fate before it counts.
 */
import { randomUUID } from "node:crypto";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";
import { fateOf, sendRemembered } from "./chain.mjs";
import { creatorFeeOwed, MIN_TAX_PAYMENT } from "./curve.mjs";
import { getLaunch } from "./db.mjs";

const BUILDING = "building:"; // + a token of its own: a request that lost its lock can never send
const LOCK_MS = 300_000;
const paidOf = (l) => BigInt(l.creator_fee_paid ?? 0);

const clear = (db, mint, sig) => db.prepare("UPDATE launches SET creator_claim_sig = NULL, creator_claim_valid = NULL, creator_claim_amount = NULL WHERE mint = ? AND creator_claim_sig = ?").run(mint, sig);
/** Conditional on the signature, so the server and the graduator can both see the same landing and count it once. */
const book = (db, l, sig) => db.prepare("UPDATE launches SET creator_fee_paid = ?, creator_claim_sig = NULL, creator_claim_valid = NULL, creator_claim_amount = NULL WHERE mint = ? AND creator_claim_sig = ?")
  .run((paidOf(l) + BigInt(l.creator_claim_amount)).toString(), l.mint, sig);

/** Resolves a collection in flight. @returns "clear" when nothing is in flight any more, "wait" when it may still land */
export async function settleCreatorClaim(conn, db, mint, now = Date.now()) {
  const l = getLaunch(db, mint);
  const sig = l?.creator_claim_sig;
  if (!sig) return "clear";
  if (sig.startsWith(BUILDING)) {
    if (now - Number(l.creator_claim_at ?? 0) < LOCK_MS) return "wait";
    clear(db, mint, sig);
    return "clear";
  }
  const fate = await fateOf(conn, sig, l.creator_claim_valid);
  if (fate === "unknown") return "wait";
  if (fate === "ok") book(db, l, sig); else clear(db, mint, sig);
  return "clear";
}

/**
 * Pays the creator what the coin owes them so far. The caller has checked who is asking.
 * @returns {{ sig: string, lamports: bigint }}
 * @throws {Error} with .code: not_trading, in_flight, too_small
 */
export async function collectCreatorFee({ conn, dbc, db, platform, mint, creatorPct, getPoolFresh, now = Date.now() }) {
  const fail = (code, message) => Object.assign(new Error(message), { code });
  if ((await settleCreatorClaim(conn, db, mint, now)) === "wait") throw fail("in_flight", "A collection is still going through.");
  let l = getLaunch(db, mint);
  if (l.status !== "trading") throw fail("not_trading", "This coin is migrating: your fees are sent to your wallet at migration.");
  // the lock first: a pool read before it could miss a collection that lands just ahead and pay the same fee twice. From here on the graduator waits.
  const lock = `${BUILDING}${randomUUID()}`;
  const got = db.prepare("UPDATE launches SET creator_claim_sig = ?, creator_claim_at = ? WHERE mint = ? AND status = 'trading' AND creator_claim_sig IS NULL").run(lock, now, mint);
  if (!got.changes) throw fail("in_flight", "A collection is still going through.");
  let owed;
  try {
    l = getLaunch(db, mint);
    const pool = await getPoolFresh(l.pool);
    owed = creatorFeeOwed({ unclaimed: BigInt(pool.partnerQuoteFee.toString()), paid: paidOf(l), creatorPct });
    if (owed < MIN_TAX_PAYMENT) throw fail("too_small", "Nothing to collect yet.");
    db.prepare("UPDATE launches SET creator_claim_amount = ? WHERE mint = ? AND creator_claim_sig = ?").run(owed.toString(), mint, lock);
  } catch (e) { clear(db, mint, lock); throw e; }
  let sent = null;
  try {
    const tx = await dbc.partner.claimPartnerTradingFee2({ feeClaimer: platform.publicKey, payer: platform.publicKey, receiver: platform.publicKey, pool: new PublicKey(l.pool), maxBaseAmount: new BN(0), maxQuoteAmount: new BN(owed.toString()) });
    tx.add(SystemProgram.transfer({ fromPubkey: platform.publicKey, toPubkey: new PublicKey(l.creator), lamports: owed }));
    const sig = await sendRemembered(conn, tx, [platform], (s, h) => {
      // the lock timed out while this was being built: someone else may have moved on, so nothing is sent
      const kept = db.prepare("UPDATE launches SET creator_claim_sig = ?, creator_claim_valid = ? WHERE mint = ? AND creator_claim_sig = ?").run(s, h, mint, lock);
      if (!kept.changes) throw new Error("the collection took too long: try again");
      sent = s;
    });
    const now2 = getLaunch(db, mint);
    if (now2.creator_claim_sig === sig) book(db, now2, sig); // the graduator may have seen the landing first
    return { sig, lamports: owed };
  } catch (e) {
    // never sent, refused, or landed and failed: nothing moved. Anything else may have landed: its signature stays for settleCreatorClaim.
    if (!sent) clear(db, mint, lock);
    else if (e.preflight || e.landedFailed) clear(db, mint, sent);
    throw e;
  }
}
