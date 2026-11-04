/**
 * The official coin: a normal SOL pair on Pumpfun from the form, for one wallet, once; its landing opens launching. node e2e/api-official.mjs
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { withProof } from './proof.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const DATA = path.join(ROOT, 'data', 'e2e-official');
fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(DATA, { recursive: true });
const RPC = 'http://127.0.0.1:8981', PORT = 5484;
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
const stub = http.createServer((req, res) => { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => { pins++; pinBodies.push(Buffer.concat(chunks).toString('latin1')); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: { cid: `bafkrei${bs58.encode(Keypair.generate().publicKey.toBytes()).toLowerCase().slice(0, 52)}` } })); }); }).listen(5397);
// the `…pump` pool, with a 1-character suffix so the test can grind its own keys: 2 keys, 1 held for the graduation
const SUFFIX = 'p';
const grind = () => { for (;;) { const k = Keypair.generate(); if (k.publicKey.toBase58().endsWith(SUFFIX)) return k; } };
fs.mkdirSync(path.join(DATA, 'vanity-incoming'), { recursive: true });
for (const k of [grind(), grind(), grind(), grind(), grind(), grind()]) fs.writeFileSync(path.join(DATA, 'vanity-incoming', `${k.publicKey.toBase58()}.json`), JSON.stringify([...k.secretKey]));
const env = { ...process.env, SOLANA_RPC: RPC, DATA_DIR: DATA, DB_PATH: path.join(DATA, 'ipo.db'), PORT: String(PORT), PINATA_JWT: 'e2e', PINATA_UPLOADS: 'http://127.0.0.1:5397', WINDOW_MIN_MINUTES: '1', TICK_MS: '3000', LAUNCH_PRIORITY_MICROLAMPORTS: '1000', TRADE_PRIORITY_MICROLAMPORTS: '1000',
  TICKER_FEE_WALLET: feeWallet.publicKey.toBase58(), VANITY_SUFFIX: SUFFIX, VANITY_REQUIRED: '1', VANITY_GRADUATION_RESERVE: '1', OFFICIAL_WALLET: creator.publicKey.toBase58(), PUBLIC_URL: `http://127.0.0.1:${PORT}`, KEYS_PER_IP_HOUR: '10', WINDOW_FIRST_BUY: '1', WINDOW_MODE: process.env.FILL ? 'fill' : 'deadline' };
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
const refused = async (p, re, m) => { const e = await p.then(() => null, (x) => x); ok(e && re.test(e.message), `${m} (${e?.message ?? 'it went through'})`); };
const URI_REAL = 'https://gateway.pinata.cloud/ipfs/bafkreihjqgnqjq6mstfm4qmnjewe3u7bh76mftjhlx4uggmroubaqp3shu'.length;
try {
  let cfg = null;
  for (let i = 0; i < 90 && !(cfg?.window?.ready); i++) { await sleep(2000); cfg = await api('/api/config').catch(() => null); }
  await sleep(5000);
  const me = creator.publicKey.toBase58(), other = buyer.publicKey.toBase58();
  const form = { name: 'Initial Pump Offering Official Ip', symbol: 'IPOFFICIAL', description: 'x', imageData: `data:image/png;base64,${PNG}`, twitter: 'https://x.com/LaunchOnIPO', website: 'https://ipopad.app' };
  ok(cfg.launchOpen === false && cfg.officialLaunch === false, 'launching is closed for the public');
  const mine = await api(`/api/config?wallet=${me}`);
  ok(mine.officialLaunch === true && mine.launchOpen === true && mine.devBuyReady === true, 'the official wallet sees the official launch, first buy ready');
  await refused(api('/api/launch/prepare', { wallet: other, official: true, ...form, devBuySol: 1 }), /not available/, 'another wallet cannot make the official launch');
  await refused(api('/api/launch/prepare', { wallet: me, official: true, ...form, devBuySol: 1, noProof: true }), /stale|signature/, 'naming the official wallet without its signature is refused');
  await refused(api('/api/launch/prepare', { wallet: me, official: true, ...form, devBuySol: 1, noProof: true, ts: Date.now(), signature: bs58.encode(new Uint8Array(64).fill(7)) }), /signature/, 'a made-up signature is refused');
  await refused(api('/api/launch/prepare', { wallet: other, ...form, devBuySol: 1 }), /opens soon/, 'another wallet still cannot launch at all');
  await refused(api('/api/launch/prepare', { wallet: me, ...form, devBuySol: 1 }), /opens soon/, 'a plain launch without the official flag is refused, even for that wallet');
  // the worst case for size: the longest name and ticker, a first buy, holder rewards, and the real length of a Pinata link
  const size = (p) => { const tx = VersionedTransaction.deserialize(Buffer.from(p.transaction, 'base64')); return tx.serialize().length; };
  const hp = await api('/api/launch/prepare', { wallet: me, official: true, ...form, name: form.name.slice(0, 32), devBuySol: 5, holderRewards: true });
  console.log(`   holder-rewards size ${size(hp)} bytes`);
  ok(size(hp) <= 1232 - Math.max(0, URI_REAL - 60), `worst case fits: ${size(hp)} bytes with room for the real link`);
  const p = await api('/api/launch/prepare', { wallet: me, official: true, ...form, name: form.name.slice(0, 32), devBuySol: 5 });
  ok(p.kind === 'pump' && p.mint.endsWith(SUFFIX), `a pump.fun launch with a pool address (${p.mint})`);
  console.log(`   creator-rewards size ${size(p)} bytes`);
  { // the review's attack: SOL sent to the coin's curve address makes an account there, not a coin
    const { SystemProgram, Transaction, sendAndConfirmTransaction } = await import('@solana/web3.js');
    const PUMP0 = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
    const fake = PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'), new PublicKey(p.mint).toBuffer()], PUMP0)[0];
    await sendAndConfirmTransaction(conn, new Transaction().add(SystemProgram.transfer({ fromPubkey: buyer.publicKey, toPubkey: fake, lamports: 890_880 })), [buyer]);
    const again = await api('/api/launch/prepare', { wallet: me, official: true, ...form, name: form.name.slice(0, 32), devBuySol: 5 });
    ok((await api('/api/config')).launchOpen === false && again.mint === p.mint, 'SOL sent to the curve address does not open launching or make a coin');
    await refused(api('/api/launch/submit', { mint: again.mint, transaction: (() => { const tx = VersionedTransaction.deserialize(Buffer.from(again.transaction, 'base64')); tx.signatures[0] = new Uint8Array(64).fill(9); return Buffer.from(tx.serialize()).toString('base64'); })() }), /Not signed/, 'a made-up transaction signature is refused before any send');
    ok((await api('/api/config')).launchOpen === false, 'launching is still closed');
    p.transaction = again.transaction;
  }
  const before = await conn.getBalance(creator.publicKey);
  const s = await api('/api/launch/submit', { mint: p.mint, transaction: sign(p.transaction, creator) });
  ok(s.status === 'live', `it landed live (${s.status})`);
  const PUMP = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
  const curve = PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'), new PublicKey(p.mint).toBuffer()], PUMP)[0];
  const info = await conn.getAccountInfo(curve, 'confirmed');
  ok(info && new PublicKey(info.data.subarray(49, 81)).equals(creator.publicKey), 'a real pump.fun curve, with the official wallet as its creator');
  const toks = await conn.getParsedTokenAccountsByOwner(creator.publicKey, { mint: new PublicKey(p.mint) });
  ok(Number(toks.value[0]?.account.data.parsed.info.tokenAmount.uiAmount) > 0, `the first buy landed in the same transaction: ${toks.value[0]?.account.data.parsed.info.tokenAmount.uiAmountString} tokens`);
  console.log(`   cost ${(before - await conn.getBalance(creator.publicKey)) / 1e9} SOL`);
  const open = await api('/api/config');
  ok(open.launchOpen === true && open.official?.mint === p.mint, 'launching opened for everyone, and it is the official coin');
  ok((await api(`/api/config?wallet=${me}`)).officialLaunch === false, 'the official launch is used up');
  await refused(api('/api/launch/prepare', { wallet: me, official: true, ...form, symbol: 'AGAIN', devBuySol: 0 }), /not available/, 'it cannot be used twice');
  { // a request the URL parser refuses must not take the server down
    const net = await import('node:net');
    await new Promise((res) => { const c = net.connect(PORT, '127.0.0.1', () => c.write('GET // HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n')); c.on('data', () => {}); c.on('close', res); c.on('error', res); });
    await sleep(500);
    ok((await api('/api/config')).launchOpen === true, 'the server survives a malformed request path');
  }
  const c = await api(`/api/coins/${p.mint}`);
  ok(c.kind === 'pump' && c.origin === 'official' && c.status === 'live' && c.capSol > 0, `the coin page reads it: ${c.kind}, ${c.origin}, cap ${c.capSol?.toFixed(1)} SOL`);
  const list = await api('/api/coins');
  ok((Array.isArray(list) ? list : list.coins)[0]?.mint === p.mint, 'it is first on the board');
  const tb = await api('/api/trade/prepare', { wallet: other, mint: p.mint, side: 'buy', amount: 0.2, slippageBps: 500 });
  const ts = await api('/api/trade/submit', { transaction: sign(tb.transaction, buyer) });
  ok(ts.sig, 'anyone can buy it through the coin page');
  const win = await api('/api/launch/prepare', { wallet: other, name: 'After', symbol: 'AFTER', imageData: `data:image/png;base64,${PNG}`, devBuySol: 0, window: { sizeSol: open.window.sizes[0].sizeSol } });
  ok(win.kind === 'window', 'other wallets can now launch on a curve');
  { // starting launches and never finishing them is capped, and only that: launching itself has no limit
    const spam = Keypair.generate(); await fund(spam.publicKey, 1);
    const size0 = open.window.sizes[0].sizeSol;
    const png = Buffer.from(PNG, 'base64');
    let n = 0, why = null;
    for (let i = 0; i < 12 && !why; i++) {
      await api('/api/launch/prepare', { wallet: spam.publicKey.toBase58(), name: 'Spam', symbol: 'SPAM', imageData: `data:image/png;base64,${Buffer.concat([png, Buffer.from(`extra${i}`)]).toString('base64')}`, devBuySol: 0, window: { sizeSol: size0 } }).then(() => { n++; }, (e) => { why = e.message; });
    }
    ok(n >= 1 && n <= 8 && /unfinished/.test(why ?? ''), `unsigned launches from one place stop at ${n}: ${why}`);
  }
  await refused(api('/api/launch/prepare', { wallet: other, name: 'Plain', symbol: 'PLAIN', imageData: `data:image/png;base64,${PNG}`, devBuySol: 0 }), /opens soon/, 'but nobody else gets a plain Pumpfun launch');
} catch (e) { fails++; console.log('FAIL (threw)', e.message); }
for (const p of procs) p.kill('SIGTERM');
stub.close();
console.log(`\n${checks} passed, ${fails} failed`);
setTimeout(() => process.exit(fails ? 1 : 0), 1500);
