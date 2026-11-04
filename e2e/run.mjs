/**
 * End to end on a local validator with pump.fun cloned from mainnet (e2e/validator.sh, port 8981): the site's REAL
 * code in-process, REAL transactions on the local chain, keypairs signing where the browser wallet would. The only
 * stub is Pinata (the one call that would leave the machine). Usage: node e2e/run.mjs
 */
import { withProof } from './proof.mjs';
const signedPrepare = async (b, ...a) => (await import('../api/launch.mjs')).prepare(withProof(b), ...a);
import http from 'node:http';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';
import fsSync from 'node:fs';

const DB = `/tmp/ipo-e2e-${process.pid}.db`;
Object.assign(process.env, { SOLANA_RPC: 'http://127.0.0.1:8981', DB_PATH: DB, DATA_DIR: `/tmp/ipo-e2e-data-${process.pid}`, VANITY_REQUIRED: '0', LAUNCH_OPEN: '1', PUBLIC_URL: 'http://127.0.0.1:5480', PINATA_JWT: 'e2e', PINATA_UPLOADS: 'http://127.0.0.1:5398', VANITY_INCOMING: `/tmp/ipo-e2e-in-${process.pid}`, LAUNCH_PRIORITY_MICROLAMPORTS: '1000', TRADE_PRIORITY_MICROLAMPORTS: '1000', LAUNCHES_PER_WALLET_DAY: '2' });
let pins = 0;
const stub = http.createServer((req, res) => { req.resume(); req.on('end', () => { pins++; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: { cid: `bafkrei${bs58.encode(Keypair.generate().publicKey.toBytes()).toLowerCase().slice(0, 52)}` } })); }); }).listen(5398);

const sol = await import('../api/sol.mjs');
const launch = await import('../api/launch.mjs');
const trade = await import('../api/trade.mjs');
const coins = await import('../api/coins.mjs');
const vanity = await import('../api/vanity.mjs');
const { one, run, now } = await import('../api/db.mjs');
const pump = await import('../lib/pump.mjs');
const { ensureLaunchLut } = await import('../scripts/make-lut.mjs');

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`); };
const step = async (name, fn) => { try { return await fn(); } catch (e) { check(name, false, e.message.slice(0, 300)); return null; } };
const refused = (p, re) => p.then(() => false, (e) => re.test(e.message) || (console.log('   (other error:', e.message.slice(0, 120), ')'), false));
const conn = sol.conn;
const fund = async (pk, n) => { const sig = await conn.requestAirdrop(pk, n * LAMPORTS_PER_SOL); await conn.confirmTransaction(sig, 'confirmed'); };
const lam = async (pk) => BigInt(await conn.getBalance(new PublicKey(pk), 'confirmed'));
const held = async (kp, M) => { const a = await conn.getAccountInfo(pump.ata(kp.publicKey, M, pump.TOKEN_2022)); return a ? pump.tokenAccountAmount(a.data) : 0n; };
const signB64 = (b64, kps) => { const tx = VersionedTransaction.deserialize(Buffer.from(b64, 'base64')); tx.sign(kps); return Buffer.from(tx.serialize()).toString('base64'); };
const w = (k) => k.publicKey.toBase58();
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const img = `data:image/png;base64,${PNG}`;

const L = Keypair.generate(), B1 = Keypair.generate(), B2 = Keypair.generate(), whale = Keypair.generate(), lutAuth = Keypair.generate();
await fund(L.publicKey, 10); await fund(B1.publicKey, 10); await fund(B2.publicKey, 10); await fund(whale.publicKey, 200); await fund(lutAuth.publicKey, 1);

/* ── 1. prepare: refusals, lookup table ── */
check('prepare without a wallet is refused', await refused(signedPrepare({ name: 'x', symbol: 'X', imageData: img }), /Connect a wallet/));
check('a first buy before the lookup table exists is refused, before any signature', await refused(signedPrepare({ wallet: w(L), name: 'x', symbol: 'X', imageData: img, devBuySol: 1 }), /First buys are not available/));
check('a bad image is refused', await refused(signedPrepare({ wallet: w(L), name: 'x', symbol: 'X', imageData: 'data:image/png;base64,AAAA' }), /PNG, JPG/));
const lut = await step('lookup table made and frozen', () => ensureLaunchLut({ authority: lutAuth, log: () => {} }));
check('lookup table recorded', Boolean(lut), lut);
const t = await pump.loadLookupTable(conn, lut);
check('lookup table is frozen', t && !t.state.authority, `${t?.state.addresses.length} accounts`);
check('devBuyReady', await launch.devBuyReady());

/* ── 2. launch with a first buy ── */
const p = await step('prepare (1 SOL first buy, long name)', () => signedPrepare({ wallet: w(L), name: 'End To End Coin With A Long Name', symbol: 'E2ELONGEST', description: 'end to end', imageData: img, devBuySol: 1, twitter: 'https://x.com/pumpdotfun', telegram: 'https://t.me/x', website: 'https://example.com' }));
const MINT = p?.mint, M = MINT && new PublicKey(MINT);
check('prepare returned a transaction and the expected tokens', p?.transaction && BigInt(p.expectedTokens) > 0n, `${p && (Number(p.expectedTokens) / 1e6).toFixed(0)} tokens`);
check('the row holds the mint secret until the coin exists', Boolean(one('SELECT mint_secret FROM launches WHERE mint = ?', MINT)?.mint_secret));
check('an unsigned launch is refused', await refused(launch.submit({ mint: MINT, transaction: p.transaction }), /not signed/i));
check('a different transaction is refused', await refused((async () => { const tx = VersionedTransaction.deserialize(Buffer.from(p.transaction, 'base64')); tx.message.recentBlockhash = bs58.encode(Buffer.alloc(32, 9)); const o = new VersionedTransaction(tx.message); o.sign([L]); return launch.submit({ mint: MINT, transaction: Buffer.from(o.serialize()).toString('base64') }); })(), /Not the transaction|not signed|missing/i));
const before = await lam(L.publicKey);
const sub = await step('submit', () => launch.submit({ mint: MINT, transaction: signB64(p.transaction, [L]) }));
check('launch is live', sub?.status === 'live', sub?.sig?.slice(0, 16));
check('mint secret deleted once live', one('SELECT mint_secret FROM launches WHERE mint = ?', MINT)?.mint_secret == null);
const st0 = await pump.coinState(conn, MINT);
check('curve exists, creator is the launcher, on its curve', st0 && st0.creator === w(L) && !st0.complete, `progress ${(st0?.progress * 100).toFixed(2)}%`);
const got = await held(L, M);
check('the first buy landed within slippage', got >= (BigInt(p.expectedTokens) * 97n) / 100n && got <= (BigInt(p.expectedTokens) * 102n) / 100n, `${(Number(got) / 1e6).toFixed(0)} tokens`);
check('launcher paid about 1 SOL + deploy cost', before - (await lam(L.publicKey)) > 1_010_000_000n && before - (await lam(L.publicKey)) < 1_060_000_000n, `${(Number(before - (await lam(L.publicKey))) / 1e9).toFixed(4)} SOL`);
check('submitting again is idempotent', (await launch.submit({ mint: MINT, transaction: p.transaction }))?.status === 'live');
check('create recorded as a trade', one("SELECT 1 FROM trades WHERE mint = ? AND side = 'create'", MINT));

/* ── 3. board ── */
let board = await coins.list({});
check('board lists the coin', board.coins.length === 1 && board.coins[0].capSol > 0, `cap ${board.coins[0]?.capSol?.toFixed(2)} SOL`);
check('search finds it by ticker, misses others', (await coins.list({ q: 'e2elong' })).coins.length === 1 && (await coins.list({ q: 'nope' })).coins.length === 0);
const page = await coins.coin(MINT);
check('coin page: holders with the curve labelled and the dev', page.holders.some((h) => h.label === 'bonding curve') && page.holders.some((h) => h.owner === w(L)), `${page.holders.length} holders`);
check('coin page: socials kept', page.socials.twitter === 'https://x.com/pumpdotfun' && page.socials.website === 'https://example.com/');

/* ── 4. trades ── */
const b1Before = await lam(B1.publicKey);
const tb = await step('trade prepare: buy 1 SOL', () => trade.prepare({ wallet: w(B1), mint: MINT, side: 'buy', amount: 1, slippageBps: 100 }));
check('trade submit of a NOT prepared transaction is refused', await refused((async () => { const tx = VersionedTransaction.deserialize(Buffer.from(tb.transaction, 'base64')); tx.message.recentBlockhash = bs58.encode(Buffer.alloc(32, 7)); const o = new VersionedTransaction(tx.message); o.sign([B1]); return trade.submit({ transaction: Buffer.from(o.serialize()).toString('base64') }); })(), /not prepared here/));
check('an unsigned trade is refused', await refused(trade.submit({ transaction: tb.transaction }), /not signed/i));
const ts = await step('trade submit: buy', () => trade.submit({ transaction: signB64(tb.transaction, [B1]) }));
const b1Held = await held(B1, M);
check('buy landed: tokens received within slippage, SOL spent', ts?.sig && b1Held >= BigInt(tb.quote.minTokenUnits) && b1Held <= (BigInt(tb.quote.tokenUnits) * 102n) / 100n && b1Before - (await lam(B1.publicKey)) > 1_000_000_000n, `${(Number(b1Held) / 1e6).toFixed(0)} tokens`);
check('the same signed trade cannot be relayed twice', await refused(trade.submit({ transaction: signB64(tb.transaction, [B1]) }), /not prepared here|expired/));
check('re-sending a transaction that already LANDED is never reported refused', await sol.sendSigned(VersionedTransaction.deserialize(Buffer.from(signB64(tb.transaction, [B1]), 'base64')), 'resend').then((s) => s === ts.sig, (e) => (console.log('   ', e.message.slice(0, 100)), false)));
check('the recorded buy holds the SETTLED amounts', (() => { const r = one('SELECT lamports, token_units AS t FROM trades WHERE sig = ?', ts.sig); return r && BigInt(r.t) === b1Held && BigInt(r.lamports) > 1_000_000_000n && BigInt(r.lamports) < 1_006_000_000n; })(), JSON.stringify(one('SELECT lamports, token_units FROM trades WHERE sig = ?', ts.sig)));
check('a non-numeric slippage is a 400, not a crash', await refused(trade.prepare({ wallet: w(B1), mint: MINT, side: 'buy', amount: 0.1, slippageBps: 'abc' }), /slippage must be a number/));
check('sell with no holdings is refused', await refused(trade.prepare({ wallet: w(B2), mint: MINT, side: 'sell', pct: 50 }), /holds none/));
const b1Mid = await lam(B1.publicKey);
const tsell = await step('trade prepare: sell 50%', () => trade.prepare({ wallet: w(B1), mint: MINT, side: 'sell', pct: 50, slippageBps: 100 }));
const ss = await step('trade submit: sell', () => trade.submit({ transaction: signB64(tsell.transaction, [B1]) }));
const b1After = await held(B1, M);
check('the recorded sell holds the SETTLED SOL (within 1% of the quote)', (() => { const r = one('SELECT lamports FROM trades WHERE sig = ?', ss.sig); return r && Math.abs(Number(r.lamports) - Number(tsell.quote.lamports)) < Number(tsell.quote.lamports) * 0.01 && BigInt(r.lamports) !== BigInt(tsell.quote.lamports); })());
check('sell landed: half the tokens gone, SOL back within slippage', ss?.sig && b1After <= b1Held / 2n + 1n && (await lam(B1.publicKey)) - b1Mid >= BigInt(tsell.quote.minLamports) - 10_000n, `+${(Number((await lam(B1.publicKey)) - b1Mid) / 1e9).toFixed(4)} SOL (quoted ${(Number(tsell.quote.lamports) / 1e9).toFixed(4)})`);
const tsell2 = await step('trade prepare: sell an exact amount', () => trade.prepare({ wallet: w(B1), mint: MINT, side: 'sell', amount: 1000, slippageBps: 100 }));
check('sell more than held is refused', await refused(trade.prepare({ wallet: w(B1), mint: MINT, side: 'sell', amount: 1e12 }), /fewer than that/));
await step('trade submit: sell exact', () => trade.submit({ transaction: signB64(tsell2.transaction, [B1]) }));
check('exact sell took 1000 tokens', b1After - (await held(B1, M)) === 1_000_000_000n);
check('trades recorded, coin bumped', one('SELECT COUNT(*) AS n FROM trades WHERE mint = ?', MINT).n === 4 && one('SELECT bumped_at FROM launches WHERE mint = ?', MINT).bumped_at > one('SELECT created_at FROM launches WHERE mint = ?', MINT).created_at);
await coins.sample(MINT);
check('a price sample was taken', one('SELECT COUNT(*) AS n FROM prices WHERE mint = ?', MINT).n >= 1);
{ // the chart: every trade on the curve read back from the chain, priced as it traded, the live price closing the last candle
  const history = await import('../api/history.mjs');
  await history.indexNow(MINT);
  const st = await pump.coinState(conn, MINT);
  const ch = history.chart(MINT, st.priceSol);
  const sides = ch.trades.map((t) => t.side).reverse();
  check('chart indexed the curve trades from the chain', ch.total === 4 && sides.join(',') === 'buy,buy,sell,sell', `${ch.total} trades: ${sides.join(',')}`);
  const last = ch.candles[ch.candles.length - 1];
  check('candles exist and the last close is the live curve price', ch.candles.length >= 1 && Math.abs(last.c - st.priceSol) / st.priceSol < 1e-9, `${ch.candles.length} candles`);
  const buy = ch.trades.find((t) => t.side === 'buy' && t.wallet === w(B1));
  check('a trade carries wallet, SOL and tokens as they moved', buy && BigInt(buy.tokenUnits) === b1Held && Math.abs(Number(buy.lamports) / 1e9 - 1) < 0.02, buy && `${Number(buy.lamports) / 1e9} SOL`);
}
check('ticker shows the events, newest first', (() => { const tk = coins.ticker(); return tk.length === 4 && tk[0].side === 'sell' && tk[3].side === 'create'; })());

check('search finds a coin by its full mint address', (await coins.list({ q: MINT })).coins.length === 1);

/* ── 6. a second launch, no first buy, by another wallet; limits; reconcile ── */
const p2 = await step('prepare (no first buy, holder rewards)', () => signedPrepare({ wallet: w(B2), name: 'Plain', symbol: 'PLAIN', imageData: img, holderRewards: true }));
const s2 = await step('submit 2', () => launch.submit({ mint: p2.mint, transaction: signB64(p2.transaction, [B2]) }));
check('second coin live', s2?.status === 'live');
check('holder rewards: the curve creator is the holder-rewards PDA', (await pump.coinState(conn, p2.mint))?.creator === pump.holderRewardsAddress(new PublicKey(p2.mint)).toBase58());
check('metadata URI is hosted by the site', one('SELECT metadata_uri AS u FROM launches WHERE mint = ?', p2.mint).u.startsWith('http://127.0.0.1:5480/meta/'));
board = await coins.list({ sort: 'cap' });
check('board: 2 coins, cap sort', board.coins.length === 2 && board.coins[0].mint === MINT);
check('bump order puts the newest activity first', (await coins.list({ sort: 'bump' })).coins[0].mint === p2.mint);
run("UPDATE launches SET status = 'created', updated_at = ? WHERE mint = ?", now() - 60_000, p2.mint);
check('reconcile heals a row left created', (await launch.reconcile()) === 1 && one('SELECT status FROM launches WHERE mint = ?', p2.mint).status === 'live');
await step('prepare 3 (second for L)', () => signedPrepare({ wallet: w(L), name: 'Two', symbol: 'TWO', imageData: img }));
check('two prepares at once by one wallet: the second is refused', await (async () => { const a = signedPrepare({ wallet: w(whale), name: 'Par', symbol: 'PAR', imageData: img }); const b = refused(signedPrepare({ wallet: w(whale), name: 'Par2', symbol: 'PAR2', imageData: img }), /already preparing/); const [ra, rb] = await Promise.all([a.then(() => true, () => false), b]); return ra && rb; })());
// a launch marked failed by a lost answer, whose coin IS on chain: prepare by the same wallet revives it instead of deleting it
run("UPDATE launches SET status = 'failed' WHERE mint = ?", p2.mint);
vanity.addKey && run("INSERT OR IGNORE INTO vanity (pubkey, secret, state, launcher, issued_at, created_at) VALUES (?, '[]', 'issued', ?, ?, ?)", p2.mint, w(B2), now(), now());
check('reconcile revives a failed row whose coin exists', (await launch.reconcile()) >= 1 && one('SELECT status FROM launches WHERE mint = ?', p2.mint).status === 'live');
check('per-wallet daily launch limit', await refused(signedPrepare({ wallet: w(L), name: 'Three', symbol: 'THREE', imageData: img }), /enough coins for today/));
check('an unknown mint on the coin page is 404', await refused(coins.coin(Keypair.generate().publicKey.toBase58()), /No such coin/));
check('vanity import ignores junk', (() => { const fs = fsSync; fs.mkdirSync(vanity.INCOMING, { recursive: true }); fs.writeFileSync(`${vanity.INCOMING}/junkpump.json`, 'nope'); return vanity.importIncoming() === 0 && fs.existsSync(`${vanity.INCOMING}/junkpump.json`); })());

/* ── 7. graduation ── */
const wb = await step('whale buys 84 SOL', () => trade.prepare({ wallet: w(whale), mint: MINT, side: 'buy', amount: 84, slippageBps: 500 }));
await step('whale submit', () => trade.submit({ transaction: signB64(wb.transaction, [whale]) }));
let stG = await pump.coinState(conn, MINT);
console.log(`   after 84 SOL: progress ${(stG.progress * 100).toFixed(2)}% complete=${stG.complete} realSol=${stG.realSol.toFixed(2)}`);
if (!stG.complete) {
  const wb2 = await step('whale buys the rest (10 SOL, partial fill expected)', () => trade.prepare({ wallet: w(whale), mint: MINT, side: 'buy', amount: 10, slippageBps: 500 }));
  if (wb2) await step('whale submit 2', () => trade.submit({ transaction: signB64(wb2.transaction, [whale]) }));
  stG = await pump.coinState(conn, MINT);
}
check('curve completed', stG.complete, `progress ${(stG.progress * 100).toFixed(1)}% realSol ${stG.realSol.toFixed(2)}`);
check('trading a graduated coin is refused with a clear reason', await refused(trade.prepare({ wallet: w(B1), mint: MINT, side: 'sell', pct: 100 }), /graduated/));
const bg = await coins.list({});
check('board shows it graduated without a zero cap scare', bg.coins.find((c) => c.mint === MINT)?.complete === true);

stub.close();
const fails = results.filter((r) => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} passed${fails.length ? `: FAILED ${fails.map((f) => f.name).join(' | ')}` : ''}`);
process.exit(fails.length ? 1 : 0);
