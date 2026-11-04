/**
 * The creator fee on a coin set to creator rewards: collected on the coin page, the rest sent at migration. node e2e/api-creator-fee.mjs
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { withProof } from './proof.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const DATA = path.join(ROOT, 'data', 'e2e-creator-fee');
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(DATA, { recursive: true });
const RPC = 'http://127.0.0.1:8981', PORT = 5483;
const conn = new Connection(RPC, 'confirmed');
const platform = Keypair.generate();
fs.writeFileSync(path.join(DATA, 'platform.json'), JSON.stringify([...platform.secretKey]));
const creator = Keypair.generate(), buyer = Keypair.generate();
const feeWallet = Keypair.generate();
const fund = async (pk, n = 100) => conn.confirmTransaction(await conn.requestAirdrop(pk, n * LAMPORTS_PER_SOL), 'confirmed');
await fund(platform.publicKey, 100); await fund(creator.publicKey, 20); await fund(buyer.publicKey, 60);
await conn.confirmTransaction(await conn.requestAirdrop(new PublicKey('FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM'), 2 * LAMPORTS_PER_SOL), 'confirmed');
let pins = 0;
const pinBodies = [];
const stub = http.createServer((req, res) => { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => { pins++; pinBodies.push(Buffer.concat(chunks).toString('latin1')); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: { cid: `bafkrei${bs58.encode(Keypair.generate().publicKey.toBytes()).toLowerCase().slice(0, 52)}` } })); }); }).listen(5398);
// the `…pump` pool, with a 1-character suffix so the test can grind its own keys: 2 keys, 1 held for the graduation
const SUFFIX = 'p';
const grind = () => { for (;;) { const k = Keypair.generate(); if (k.publicKey.toBase58().endsWith(SUFFIX)) return k; } };
fs.mkdirSync(path.join(DATA, 'vanity-incoming'), { recursive: true });
for (const k of [grind(), grind(), grind(), grind(), grind(), grind()]) fs.writeFileSync(path.join(DATA, 'vanity-incoming', `${k.publicKey.toBase58()}.json`), JSON.stringify([...k.secretKey]));
const env = { ...process.env, SOLANA_RPC: RPC, DATA_DIR: DATA, DB_PATH: path.join(DATA, 'ipo.db'), PORT: String(PORT), PINATA_JWT: 'e2e', PINATA_UPLOADS: 'http://127.0.0.1:5398', WINDOW_MIN_MINUTES: '1', TICK_MS: '3000', LAUNCH_PRIORITY_MICROLAMPORTS: '1000', TRADE_PRIORITY_MICROLAMPORTS: '1000',
  TICKER_FEE_WALLET: feeWallet.publicKey.toBase58(), VANITY_SUFFIX: SUFFIX, VANITY_REQUIRED: '1', VANITY_GRADUATION_RESERVE: '1', PUBLIC_URL: `http://127.0.0.1:${PORT}`, LAUNCH_OPEN: '1', KEYS_PER_IP_HOUR: '10', WINDOW_FIRST_BUY: '1', WINDOW_MODE: process.env.FILL ? 'fill' : 'deadline' };
const FILL = Boolean(process.env.FILL);
const procs = [];
const run = (name, args) => { const p = spawn('node', args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] }); p.stdout.on('data', (d) => process.stdout.write(`   [${name}] ${d}`)); p.stderr.on('data', (d) => process.stdout.write(`   [${name}!] ${d}`)); procs.push(p); return p; };
run('grad', ['api/graduator.mjs']);
await new Promise((r) => setTimeout(r, 2500));
run('api', ['api/server.mjs']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p, body0) => { const body = p === '/api/launch/prepare' ? withProof(body0) : body0; const r = await fetch(`http://127.0.0.1:${PORT}${p}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}); const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); return j; };
let checks = 0, fails = 0;
const ok = (c, m) => { if (c) { checks++; console.log('PASS', m); } else { fails++; console.log('FAIL', m); } };
const sign = (b64, kp) => { const tx = VersionedTransaction.deserialize(Buffer.from(b64, 'base64')); tx.sign([kp]); return Buffer.from(tx.serialize()).toString('base64'); };
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
import { ed25519 } from '@noble/curves/ed25519.js';
const signMsg = (kp, mint, ts) => bs58.encode(ed25519.sign(new TextEncoder().encode(`ipo creator fee\nmint: ${mint}\ntime: ${ts}`), kp.secretKey.slice(0, 32)));
const collect = (kp, mint, ts = Date.now(), wallet = kp.publicKey.toBase58()) => api(`/api/coins/${mint}/creator-fee`, { wallet, ts, signature: signMsg(kp, mint, ts) });
const refused = async (p, re, m) => { const e = await p.then(() => null, (x) => x); ok(e && re.test(e.message), `${m} (${e?.message ?? 'it went through'})`); };
const LAMPORTS = 1e9;
try {
  let cfg = null;
  for (let i = 0; i < 90 && !(cfg?.window?.ready && cfg.window.sizes.length >= 4); i++) { await sleep(2000); cfg = await api('/api/config').catch(() => null); }
  await sleep(5000);
  const size = cfg.window.sizes[0].sizeSol;
  const launchCoin = async (kp, symbol, holderRewards) => {
    const p = await api('/api/launch/prepare', { wallet: kp.publicKey.toBase58(), name: symbol, symbol, imageData: `data:image/png;base64,${PNG}`, holderRewards, devBuySol: 0, window: { sizeSol: size, holderRewards } });
    await api('/api/launch/submit', { mint: p.mint, transaction: sign(p.transaction, kp) });
    return p.mint;
  };
  const mint = await launchCoin(creator, 'CFEE', false);
  const buy = async (w, m, amount = 0.7) => { const b = await api('/api/trade/prepare', { wallet: w.publicKey.toBase58(), mint: m, side: 'buy', amount, slippageBps: 500 }); return api('/api/trade/submit', { transaction: sign(b.transaction, w) }); };
  let c = await api(`/api/coins/${mint}`);
  for (let i = 0; i < 15 && c.window.phase !== 'trading'; i++) { await sleep(1000); c = await api(`/api/coins/${mint}`); }
  ok(c.window.creatorFee && c.window.creatorFee.owed === '0', 'a creator-rewards coin shows its creator fee on the page');
  await buy(buyer, mint);
  await sleep(6000);
  c = await api(`/api/coins/${mint}`);
  const owed = BigInt(c.window.creatorFee.owed);
  ok(owed > 0n && Number(owed) / LAMPORTS > 0.0015, `after a 0.7 SOL buy the creator is owed ${Number(owed) / LAMPORTS} SOL`);

  const ts = Date.now();
  await refused(api(`/api/coins/${mint}/creator-fee`, { wallet: creator.publicKey.toBase58(), ts, signature: signMsg(buyer, mint, ts) }), /signature/, "another wallet's signature is refused");
  await refused(collect(buyer, mint), /Only the creator/, "another wallet can't collect, even with its own signature");
  await refused(collect(creator, mint, Date.now() - 10 * 60_000), /stale/, 'an old signature is refused');
  // a second buy to pass the minimum if the first one did not
  const crowd = Array.from({ length: 24 }, () => Keypair.generate());
  for (const w of crowd) await fund(w.publicKey, 2);
  await buy(crowd[0], mint); await sleep(6000);
  c = await api(`/api/coins/${mint}`);
  const due = BigInt(c.window.creatorFee.owed);
  const before = BigInt(await conn.getBalance(creator.publicKey)), hotBefore = BigInt(await conn.getBalance(platform.publicKey));
  // two presses at once: only one pays
  const both = await Promise.allSettled([collect(creator, mint), collect(creator, mint, Date.now() + 1)]);
  const paidNow = both.filter((r) => r.status === 'fulfilled');
  ok(paidNow.length === 1, `two presses at once pay once (${both.map((r) => r.status === 'fulfilled' ? 'paid' : r.reason.message).join(' / ')})`);
  await sleep(1500);
  const after = BigInt(await conn.getBalance(creator.publicKey)), hotAfter = BigInt(await conn.getBalance(platform.publicKey));
  ok(after - before === due, `the creator received exactly what the page showed: ${Number(after - before) / LAMPORTS} SOL`);
  ok(hotBefore - hotAfter < 3_000_000n, `the hot wallet only paid the costs: ${Number(hotBefore - hotAfter) / LAMPORTS} SOL`);
  await sleep(6000);
  c = await api(`/api/coins/${mint}`);
  ok(c.window.creatorFee.owed === '0' && BigInt(c.window.creatorFee.paid) === due, 'the page shows nothing left and what was paid');
  await refused(collect(creator, mint), /Nothing to collect/, 'a second collection with nothing new is refused');
  // the DB row must be clean, and the platform's own share still on the pool
  // a holder-rewards coin has no button, and its creator cannot take the share
  const hm = await launchCoin(buyer, 'HFEE', true);
  ok((await api(`/api/coins/${hm}`)).window.creatorFee == null, 'a holder-rewards coin shows no creator fee');
  await refused(collect(buyer, hm), /no fees to collect/, "a holder-rewards coin's creator can't collect");

  // fill it: the rest goes at migration
  const beforeFill = BigInt(await conn.getBalance(creator.publicKey));
  let buys = 0;
  for (const w of crowd.slice(1)) {
    c = await api(`/api/coins/${mint}`);
    if (c.window.phase !== 'trading') break;
    const r = await buy(w, mint).then(() => 1, (e) => { console.log('   buy refused:', e.message); return 0; });
    buys += r; await sleep(900);
  }
  for (let i = 0; i < 60 && c.window.status !== 'done'; i++) { await sleep(3000); c = await api(`/api/coins/${mint}`).catch(() => c); }
  ok(c.window.status === 'done', `the curve filled and the coin migrated (${c.window.status}, ${buys} more buys)`);
  const sent = BigInt(await conn.getBalance(creator.publicKey)) - beforeFill;
  const { default: Database } = await import('node:sqlite').then((m) => ({ default: m.DatabaseSync }));
  const row = new Database(path.join(DATA, 'ledger.db')).prepare('SELECT fees_claimed, creator_fee_paid, tax_creator, tax_paid, tax_total, holders_fee, creator_claim_sig FROM launches WHERE mint = ?').get(mint);
  console.log('   ledger', JSON.stringify(row));
  const total = BigInt(row.fees_claimed) + BigInt(row.creator_fee_paid);
  const share = (total * 30n) / 100n;
  ok(sent === BigInt(row.tax_creator) && row.tax_paid === 1, `the rest reached the creator at migration: ${Number(sent) / LAMPORTS} SOL`);
  const diff = share - (BigInt(row.creator_fee_paid) + sent);
  ok(diff >= -1n && diff <= 1n, `collected + migration = 30% of all curve fees: ${Number(BigInt(row.creator_fee_paid) + sent) / LAMPORTS} of ${Number(total) / LAMPORTS} SOL`);
  ok(!row.creator_claim_sig && !row.holders_fee?.replace(/^0$/, ''), 'nothing in flight, nothing booked for holders');
  await refused(collect(creator, mint), /migrating/, 'after migration the button is gone: the server refuses too');
  ok(BigInt(c.window.creatorFee.paid) === BigInt(row.creator_fee_paid) + sent, `the page shows all of it as paid: ${Number(c.window.creatorFee.paid) / LAMPORTS} SOL`);
  { // the analytics page adds this coin up from what the ledger and the history saved
    const a = await api('/api/analytics');
    console.log('   analytics', JSON.stringify({ all: { ...a.ranges.all, top: a.ranges.all.top.length }, coins: a.coins, holders: a.holders, byRewards: a.byRewards, byCap: a.byCap, byPair: a.byPair, people: a.people, waiting: a.waiting }));
    const all = a.ranges.all, day = a.ranges['24h'];
    ok(all.launches === 2 && all.migrations === 1, `analytics counts 2 launches, 1 migration (${all.launches}, ${all.migrations})`);
    ok(a.coins.total === 2 && a.coins.migrated === 1 && a.coins.onCurve === 1, 'analytics: 1 on a curve, 1 migrated');
    ok(Math.abs(all.split.creators - Number(BigInt(row.creator_fee_paid) + sent) / LAMPORTS) < 1e-6, `analytics: creators got ${all.split.creators} SOL`);
    const claimable = Number(total) / LAMPORTS;
    ok(Math.abs(all.fees - claimable / 0.8) < 1e-6 && Math.abs(all.split.meteora - claimable / 0.8 * 0.2) < 1e-6, `analytics: fees ${all.fees} SOL, Meteora 20%`);
    const shares = all.split.creators + all.split.holders + all.split.platform + all.split.meteora;
    ok(Math.abs(shares - all.fees) < 1e-6, 'analytics: the fee split adds up to the fees');
    ok(all.volume >= size * 0.99 && all.top[0]?.mint === mint, `analytics: curve volume ${all.volume} SOL, this coin on top`);
    ok(day.launches === all.launches && a.series.length >= 1 && a.series.at(-1).launches === 2, 'analytics: the ranges and the daily rows agree');
    ok(a.holders.paid > 0 && a.holders.keptPct > 90 && a.holders.keptPct <= 100, `analytics: ${a.holders.paid} wallets paid, ${a.holders.keptPct}% of their coins`);
    ok(a.byRewards.creator === 1 && a.byRewards.holders === 1 && a.byPair[0]?.name === 'SOL', 'analytics: rewards and pair groups');
  }
  const hc = await api(`/api/coins/${mint}`);
  const hold = hc.holders.filter((h) => h.pct < 0.005);
  ok(hold.length === 0, 'the holder list has no 0.00% wallets');
} catch (e) { fails++; console.log('FAIL (threw)', e.message); }
for (const p of procs) p.kill('SIGTERM');
stub.close();
console.log(`\n${checks} passed, ${fails} failed`);
setTimeout(() => process.exit(fails ? 1 : 0), 1500);
