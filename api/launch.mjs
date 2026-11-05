/**
 * Launching a pump.fun coin from the user's own wallet.
 *
 *   prepare: validate the form, pin image + metadata JSON on IPFS (Pinata), take a mint key (a `pump` address from the
 *            pool, or a plain one), build ONE transaction: create_v2 (+ the optional first buy), simulate it, sign it with
 *            the mint key, hand it to the browser.
 *   submit:  the browser returns it signed by the wallet; it must be the prepared transaction byte for byte (payer = the
 *            launcher). Relayed, then the coin is live once its bonding curve exists on chain.
 * The launcher is pump.fun's creator (creator rewards go to them), exactly as on pump.fun's own site.
 */
import { ComputeBudgetProgram, Keypair, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import bs58 from 'bs58';
import { ed25519 } from '@noble/curves/ed25519.js';
import { env, num, PROD } from './env.mjs';
import { all, one, run, now, getKv, setKv, DB_PATH } from './db.mjs';
import * as sol from './sol.mjs';
import { ApiError } from './errors.mjs';
import * as images from './images.mjs';
import * as vanity from './vanity.mjs';
import * as window from './window.mjs';
import { TOKEN_2022, ata, createV2Ix, buyExactSolInIx, loadGlobal, bondingCurveAddress, holderRewardsAddress, tokensForSol, loadLookupTable, PUMP } from '../lib/pump.mjs';

export const NAME_MAX = 32;
export const SYMBOL_MAX = 10;
export const DESCRIPTION_MAX = 1000;
export const IMAGE_MAX_BYTES = 1024 * 1024;
export const MAX_DEV_BUY_SOL = num('MAX_DEV_BUY_SOL', 50);
const PRIORITY = num('LAUNCH_PRIORITY_MICROLAMPORTS', 200_000);
const MAX_TX_BYTES = 1232;
/** Rent for the mint, curve, metadata and token accounts pump.fun creates, plus fees: about 0.025 SOL on mainnet. */
export const DEPLOY_COST_LAMPORTS = 25_000_000n;
/** A window launch: Meteora pool + hook accounts, measured ~0.045 SOL on IPO; held with room. */
export const WINDOW_DEPLOY_COST_LAMPORTS = 60_000_000n;

/**
 * Metadata lives on IPFS through Pinata when PINATA_JWT is set (operator, 4 Nov 2026): the image and the JSON are both pinned and the
 * URI on chain names a gateway that serves them. The curve token and the pump.fun coin carry the same URI, so they show the same image,
 * and it does not depend on this server staying up. ⛔ Never ipfs.io in a URI (403 for plain fetches). Without a key (tests) the site hosts it.
 */
export const PUBLIC_URL = env('PUBLIC_URL', `http://127.0.0.1:${num('PORT', 5560)}`).replace(/\/$/, '');
export const META_DIR = path.join(path.dirname(DB_PATH), 'meta');
fs.mkdirSync(META_DIR, { recursive: true });
export const configured = () => Boolean(PUBLIC_URL) && (!PROD || /^https:\/\//.test(PUBLIC_URL));
export const WINDOW_ONLY = env('WINDOW_ONLY', '1') === '1';
/** ⛔ Launching is CLOSED until the operator's own token is live (scripts/golive.mjs <CA> opens it; LAUNCH_OPEN=1 is for tests). */
export const launchOpen = () => env('LAUNCH_OPEN', '') === '1' || Boolean(getKv('launchOpen', false));
/** Wallets that may launch while the gate is closed (the operator's own test launch): kv launchAllow = [address, …]
 *  (scripts/golive.mjs --allow <wallet>). Nothing else about a launch changes for them. */
export const launchAllowed = (wallet) => Boolean(wallet) && (getKv('launchAllow', []) || []).includes(String(wallet));
/**
 * The one exception to curve launches (operator, 4 Nov 2026): $IPO itself is a normal SOL pair on Pumpfun, launched from the form by OFFICIAL_WALLET alone,
 * with an `ipo` address from the pool. Once. Its landing lists it as the official coin and opens launching for everyone (markLive).
 */
export const officialAllowed = (wallet) => Boolean(wallet) && wallet === env('OFFICIAL_WALLET', '') && !getKv('officialLive', null);
/** What the official wallet's form starts with (operator, 4 Nov): still editable there. */
export const OFFICIAL_PRESET = { name: 'Initial Pump Offering', symbol: 'IPO', twitter: 'https://x.com/LaunchOnIPO', website: 'https://ipopad.app/', image: '/ipo-token.png' };
export const prepareMessage = (wallet, ts) => `ipo launch\nwallet: ${wallet}\ntime: ${ts}`;
/** The launch lookup table (scripts/make-lut.mjs; kv launchLut or LOOKUP_TABLE). Without one a launch cannot carry a first buy. */
const lutShared = sol.shared(async () => { const a = env('LOOKUP_TABLE', '') || getKv('launchLut', null); return a ? loadLookupTable(sol.conn, a) : window.graduationLut(); }, 600_000);
/** ⛔ "No table yet" is never cached: the moment scripts/make-lut.mjs records one, the next launch uses it. */
export const lookupTable = async () => { const t = await lutShared().catch(() => null); if (!t) lutShared.forget(); return t; };
export const devBuyReady = async () => Boolean(await lookupTable());
const budget = (units) => [ComputeBudgetProgram.setComputeUnitLimit({ units }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY })];
const msgHash = (tx) => createHash('sha256').update(tx.message.serialize()).digest('hex');

/* ───────────── validation ───────────── */

const INVISIBLE = /[\p{Cf}\p{Zl}\p{Zp}]/gu;
const clean = (s, max) => String(s ?? '').normalize('NFKC').replace(INVISIBLE, '').trim().slice(0, max);

export const cleanUrl = (u, hosts = null) => {
  const s = clean(u, 300);
  if (!s) return null;
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    throw new ApiError(`Not a link: ${s.slice(0, 60)}`);
  }
  if (url.protocol !== 'https:') throw new ApiError('Links must start with https://');
  if (hosts && !hosts.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))) throw new ApiError(`That link must be on ${hosts.join(' or ')}`);
  return url.toString().slice(0, 200);
};

export function validate(body) {
  const name = clean(body.name, NAME_MAX + 1);
  const symbol = clean(body.symbol, SYMBOL_MAX + 1).toUpperCase();
  if (!name || Buffer.byteLength(name) > NAME_MAX) throw new ApiError(`A name of 1 to ${NAME_MAX} characters is required (special characters count double)`);
  if (!/^[A-Z0-9]{1,10}$/.test(symbol)) throw new ApiError('The ticker is 1 to 10 letters or numbers, no spaces');
  const description = clean(body.description, DESCRIPTION_MAX);
  const devBuy = Number(body.devBuySol || 0);
  if (!(devBuy >= 0 && devBuy <= MAX_DEV_BUY_SOL)) throw new ApiError(`The first buy is 0 to ${MAX_DEV_BUY_SOL} SOL`);
  // pump.fun's creator-rewards choice, fixed at launch: the creator keeps them (the fee schedule) or they go to holders forever
  const holderRewards = body.holderRewards === true || body.holderRewards === 'holders';
  const socials = {
    website: cleanUrl(body.website),
    twitter: cleanUrl(body.twitter, ['x.com', 'twitter.com']),
    telegram: cleanUrl(body.telegram, ['t.me', 'telegram.me']),
  };
  return { name, symbol, description, devBuyLamports: BigInt(Math.round(devBuy * 1e9)), socials, holderRewards };
}

/** An uploaded image (base64 data URL). The type comes from the bytes, never from the label. */
export function readImage(body) {
  const m = String(body.imageData || '').match(/^data:[a-z0-9.+/-]*;base64,([A-Za-z0-9+/=]+)$/i);
  if (!m) throw new ApiError('Every coin needs an image: upload a PNG, JPG, WebP or GIF');
  const bytes = Buffer.from(m[1], 'base64');
  if (bytes.length > IMAGE_MAX_BYTES) throw new ApiError('The image is over 1 MB');
  const type = images.imageType(bytes);
  if (!type) throw new ApiError('The image must be a PNG, JPG, WebP or GIF file');
  return { bytes, type };
}

/* ───────────── metadata on IPFS ───────────── */

/** pump.fun's metadata shape (what its own uploader writes): name, symbol, description, image, showName, createdOn, socials. */
export const metadataJson = (form, imageUrl) => ({
  name: form.name, symbol: form.symbol, description: form.description, image: imageUrl, showName: true, createdOn: 'pump.fun',
  ...(form.socials.twitter ? { twitter: form.socials.twitter } : {}), ...(form.socials.telegram ? { telegram: form.socials.telegram } : {}), ...(form.socials.website ? { website: form.socials.website } : {}),
});

/**
 * Writes the metadata this site serves: the image is already stored by content hash (api/images.mjs), the JSON goes beside
 * it under its own hash. Returns the URI create_v2 (or the Meteora pool) records. Pinned to IPFS too, in the background.
 */
export async function publishMetadata({ image, form, shownImage }) {
  if (env('PINATA_JWT', '')) {
    const fp = createHash('sha256').update(image.bytes).update(JSON.stringify([form.name, form.symbol, form.description, form.socials])).digest('hex');
    const cached = pinned.get(fp); // the same launch prepared again must not pin again
    if (cached) return cached;
    const p = await pinMetadata({ image, form });
    pinned.set(fp, p);
    if (pinned.size > 500) pinned.delete(pinned.keys().next().value);
    return p;
  }
  const imageName = shownImage.split('/').pop();
  const imageUrl = `${PUBLIC_URL}/img/${imageName}`;
  const json = JSON.stringify(metadataJson(form, imageUrl));
  const name = `${createHash('sha256').update(json).digest('hex').slice(0, 32)}.json`;
  const file = path.join(META_DIR, name);
  if (!fs.existsSync(file)) fs.writeFileSync(file, json);
  return { uri: `${PUBLIC_URL}/meta/${name}`, metadata: JSON.parse(json), name };
}
const pinned = new Map();
/** GET /meta/<name>: the JSON as written, long-cached (content-hashed). False when there is no such file. */
export function serveMetadata(res, name) {
  if (!/^[0-9a-f]{32}\.json$/.test(name)) return false;
  const file = path.join(META_DIR, name);
  if (!fs.existsSync(file)) return false;
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=31536000, immutable', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' });
  fs.createReadStream(file).pipe(res);
  return true;
}

/** Pinata v3 Files API (public network): the image, then the JSON around it. */
export const IPFS_GATEWAY = () => env('IPFS_GATEWAY', 'https://gateway.pinata.cloud').replace(/\/$/, '');
export async function pinMetadata({ image, form }) {
  const jwt = env('PINATA_JWT', '');
  if (!jwt) throw new ApiError('No IPFS key.', 503);
  const base = env('PINATA_UPLOADS', 'https://uploads.pinata.cloud');
  const pin = async (blob, name) => {
    const f = new FormData();
    f.append('file', blob, name);
    f.append('network', 'public');
    f.append('name', name);
    const r = await fetch(`${base}/v3/files`, { method: 'POST', headers: { authorization: `Bearer ${jwt}` }, body: f, signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new ApiError(`The image host refused the ${name.endsWith('.json') ? 'metadata' : 'image'} (${r.status}). Nothing was sent.`, 502);
    const cid = (await r.json().catch(() => ({})))?.data?.cid;
    if (!/^[A-Za-z0-9]{40,100}$/.test(cid || '')) throw new ApiError('The image host returned no content hash. Nothing was sent.', 502);
    return cid;
  };
  const ext = { 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' }[image.type] || '.jpg';
  const imageCid = await pin(new Blob([image.bytes], { type: image.type }), `${form.symbol}-image${ext}`);
  const metadata = {
    name: form.name, symbol: form.symbol, description: form.description, image: `${IPFS_GATEWAY()}/ipfs/${imageCid}`, showName: true, createdOn: 'https://pump.fun',
    ...(form.socials.twitter ? { twitter: form.socials.twitter } : {}), ...(form.socials.telegram ? { telegram: form.socials.telegram } : {}), ...(form.socials.website ? { website: form.socials.website } : {}),
  };
  const metaCid = await pin(new Blob([JSON.stringify(metadata)], { type: 'application/json' }), `${form.symbol}-metadata.json`);
  // a fresh pin's first gateway read takes 5-7 s (measured): read both now, so the first indexer does not wait or time out
  for (const cid of [imageCid, metaCid]) fetch(`${IPFS_GATEWAY()}/ipfs/${cid}`, { signal: AbortSignal.timeout(60_000) }).then((r) => r.arrayBuffer()).catch(() => {});
  return { uri: `${IPFS_GATEWAY()}/ipfs/${metaCid}`, metadata, cids: [imageCid, metaCid] };
}

/** Unpins a coin's image and JSON from Pinata (a removed test coin). True when both are gone. */
export async function unpinMetadata(uri) {
  const jwt = env('PINATA_JWT', ''), cidOf = (u) => /\/ipfs\/([A-Za-z0-9]{40,100})/.exec(String(u || ''))?.[1];
  const metaCid = cidOf(uri);
  if (!jwt || !metaCid) return false;
  const imageCid = cidOf((await (await fetch(uri, { signal: AbortSignal.timeout(30_000) })).json().catch(() => ({}))).image);
  let all = true;
  for (const cid of [imageCid, metaCid].filter(Boolean)) {
    const found = await (await fetch(`https://api.pinata.cloud/v3/files/public?cid=${cid}`, { headers: { authorization: `Bearer ${jwt}` }, signal: AbortSignal.timeout(15_000) })).json().catch(() => null);
    const files = found?.data?.files ?? [];
    if (!files.length) { all = false; continue; }
    for (const f of files) if (!(await fetch(`https://api.pinata.cloud/v3/files/public/${f.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${jwt}` }, signal: AbortSignal.timeout(15_000) })).ok) all = false;
  }
  return all;
}

/* ───────────── the transaction ───────────── */

export async function buildLaunchTx({ mint, launcher, form, uri }) {
  const l = new PublicKey(launcher), m = mint.publicKey;
  const ixs = [...budget(form.devBuyLamports > 0n ? 300_000 : 200_000), await createV2Ix(sol.conn, { mint: m, user: l, name: form.name, symbol: form.symbol, uri, creator: l, holderRewards: form.holderRewards })];
  // with holder rewards the curve's creator IS the holder-rewards PDA: the first buy's creator vault derives from it
  const curveCreator = form.holderRewards ? holderRewardsAddress(m) : l;
  let expectedTokens = 0n;
  if (form.devBuyLamports > 0n) {
    const global = await loadGlobal(sol.conn);
    // A fresh curve: pump.fun's initial virtual reserves, from Global.
    expectedTokens = tokensForSol({ virtual_token_reserves: global.initial_virtual_token_reserves, virtual_quote_reserves: global.initial_virtual_sol_reserves, real_token_reserves: global.initial_real_token_reserves }, form.devBuyLamports);
    ixs.push(createAssociatedTokenAccountIdempotentInstruction(l, ata(l, m, TOKEN_2022), l, m, TOKEN_2022));
    ixs.push(await buyExactSolInIx(sol.conn, global, { mint: m, user: l, creator: curveCreator, lamports: form.devBuyLamports, minTokensOut: (expectedTokens * 97n) / 100n }));
  }
  const lut = await lookupTable();
  if (form.devBuyLamports > 0n && !lut) throw new ApiError('First buys are not available on this server yet (its lookup table is not made). Launch without one, or try later.', 503);
  const { blockhash } = await sol.conn.getLatestBlockhash('confirmed');
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: l, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(lut ? [lut] : []));
  if (tx.serialize().length > MAX_TX_BYTES) throw new ApiError('This launch does not fit in one transaction. Try a shorter name.', 400);
  tx.sign([mint]);
  return { tx, hash: msgHash(tx), expectedTokens };
}

/** The submitted transaction must be THE prepared one: same message bytes, paid by the launcher, signed by both. */
export function checkLaunchTx(tx, row) {
  const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
  if (keys[0] !== row.launcher) throw new ApiError('Not paid by the launching wallet', 400);
  if (!row.tx_hash || msgHash(tx) !== row.tx_hash) throw new ApiError('Not the transaction this launch prepared', 400);
  if (!sol.signedByPayer(tx)) throw new ApiError('Not signed by the wallet', 400);
  if (!tx.signatures[1] || tx.signatures[1].every((b) => b === 0)) throw new ApiError('The coin signature is missing', 400);
}

/* ───────────── prepare / submit ───────────── */

const preparing = new Set();
/**
 * Starting a launch costs us a pin and an address even if it is never signed. So unfinished ones are capped, per wallet and per connection, and pins
 * have an hourly budget. A launch that lands never counts: launching itself has no limit (operator, 4 Nov 2026).
 */
const UNFINISHED_MAX = num('UNFINISHED_MAX', 8), UNFINISHED_MS = 15 * 60_000, PIN_BUDGET_HOUR = num('PIN_BUDGET_HOUR', 300);
const started = new Map(); // wallet or ip → [{ mint, image, at }]
let pinsThisHour = { hour: 0, n: 0 };
const landedStatus = (mint) => ['live', 'hidden', 'created'].includes(one('SELECT status FROM launches WHERE mint = ?', mint)?.status);
const unfinished = (key) => { const list = (started.get(key) ?? []).filter((x) => now() - x.at < UNFINISHED_MS && !landedStatus(x.mint)); if (list.length) started.set(key, list); else started.delete(key); return list.length; };
function checkUnfinished(launcher, ip) {
  if (unfinished(launcher) >= UNFINISHED_MAX || (ip && unfinished(ip) >= UNFINISHED_MAX)) throw new ApiError('Too many unfinished launches from here. Finish one, or try again in a few minutes.', 429);
  const hour = Math.floor(now() / 3_600_000);
  if (pinsThisHour.hour !== hour) pinsThisHour = { hour, n: 0 };
  if (pinsThisHour.n >= PIN_BUDGET_HOUR) { console.error('[launch] the hourly pin budget is used up'); throw new ApiError('Launching is very busy right now. Try again in a few minutes.', 503); }
}
function noteStarted(launcher, ip, mint, image) {
  pinsThisHour.n++;
  for (const key of [launcher, ip]) if (key) { const list = started.get(key) ?? []; if (!list.some((x) => x.mint === mint && x.image === image)) list.push({ mint, image, at: now() }); started.set(key, list); }
}
setInterval(() => { for (const key of started.keys()) unfinished(key); }, 600_000).unref();
export async function prepare(body, ip = null) {
  if (!configured()) throw new ApiError('Launching is not set up on this server yet (PUBLIC_URL).', 503);
  const launcher = String(body.wallet || '');
  const official = body.official === true;
  if (official && (!officialAllowed(launcher) || body.window)) throw new ApiError('This launch is not available.', 403);
  // one official coin: a send still confirming must finish first, or a retry could make a second
  if (official && one("SELECT 1 FROM launches WHERE origin = 'official' AND status IN ('created', 'live', 'hidden')")) throw new ApiError('The official launch is already going through. Give it a minute.', 409);
  if (!official && !launchOpen() && !launchAllowed(launcher)) throw new ApiError('Launching opens soon. Check back in a little while.', 503);
  if (body.window && !(await window.ready())) throw new ApiError('Window launches are being set up on this server. Try again in a few minutes.', 503);
  // WINDOW_ONLY=1 (IPO): every coin launched here is a window launch; a plain pump.fun launch is never offered
  if (!body.window && WINDOW_ONLY && !official) throw new ApiError('This launch is not available.', 403);
  if (!sol.isAddress(launcher)) throw new ApiError('Connect a wallet first.', 401);
  // the wallet asks for this launch itself: a key, a pin or a pair config is never spent, and a launch never replaced, on an address someone only named
  const ts = Number(body.ts);
  if (!(Math.abs(now() - ts) < 5 * 60_000)) throw new ApiError('This request is stale: try again.');
  let signed = false;
  try { signed = ed25519.verify(bs58.decode(String(body.signature || '')), new TextEncoder().encode(prepareMessage(launcher, ts)), new PublicKey(launcher).toBytes()); } catch {}
  if (!signed) throw new ApiError('The signature does not match the wallet.', 401);
  if (preparing.has(launcher)) throw new ApiError('This wallet is already preparing a launch. Wait for it to finish.', 409);
  preparing.add(launcher);
  try {
    return await prepareFor(launcher, body, ip);
  } finally {
    preparing.delete(launcher);
  }
}
/**
 * Anti-vamp (operator, 4 Nov 2026): for 24 hours after a ticker launches here for free, launching it again costs 1 SOL to the
 * treasury, for any wallet, the first launcher too. After that it is free again. Paid copies do not restart the 24 hours, or a
 * ticker could be kept paid forever. Hidden coins count; failed launches and removed test coins do not.
 */
export const TICKER_FEE_LAMPORTS = 1_000_000_000n;
export const TICKER_FEE_MS = 86_400_000;
const tickerFeeWallet = () => env('TICKER_FEE_WALLET', '') || env('TREASURY', '');
/** The unix ms the fee ends for this ticker, or null when it is free. Case does not make a new ticker. */
export function tickerFeeUntil(symbol) {
  const r = one(`SELECT MAX(created_at) AS at FROM launches WHERE symbol = ? COLLATE NOCASE AND status NOT IN ('failed', 'prepared', 'removed') AND COALESCE(ticker_fee, 0) = 0 AND created_at > ?`, symbol, now() - TICKER_FEE_MS);
  return r?.at ? r.at + TICKER_FEE_MS : null;
}
/** For the create page, as the creator types. A hint: prepare and submit are the checks. */
export function tickerStatus(symbol) {
  const s = String(symbol ?? '').trim().toUpperCase();
  const until = /^[A-Z0-9]{1,10}$/.test(s) ? tickerFeeUntil(s) : null;
  if (!until) return { symbol: s, feeSol: 0, until: null, text: null };
  const hours = Math.max(1, Math.ceil((until - now()) / 3_600_000));
  return { symbol: s, feeSol: 1, until, text: `$${s} launched here in the last 24 hours. Launching it again costs 1 SOL for the next ${hours} hour${hours === 1 ? '' : 's'}, then it is free.` };
}

async function prepareFor(launcher, body, ip) {
  const form = validate(body);
  const tickerFeeDue = Boolean(tickerFeeUntil(form.symbol));
  const feeTo = tickerFeeDue ? tickerFeeWallet() : null;
  if (tickerFeeDue && !feeTo) throw new ApiError('This ticker cannot be launched again right now. Try again in 24 hours.', 503);
  const win = body.window ? window.validateWindow(body.window) : null;
  const pair = win ? await window.validatePair(body.window.pair, body.window.pumpCreatorFeeBps) : null;
  if (win && form.devBuyLamports > 0n) { const max = await window.firstBuyMaxLamports(); if (max == null || form.devBuyLamports > max) throw new ApiError(`The first buy can take at most ${window.FIRST_BUY_MAX_SUPPLY_PCT}% of the supply: ${max ? (Number(max) / 1e9).toFixed(3) : '?'} SOL at most.`); }
  const image = readImage(body);
  const balance = BigInt(await sol.conn.getBalance(new PublicKey(launcher)));
  const needed = form.devBuyLamports + (win ? WINDOW_DEPLOY_COST_LAMPORTS : DEPLOY_COST_LAMPORTS) + (tickerFeeDue ? TICKER_FEE_LAMPORTS : 0n);
  if (balance < needed) throw new ApiError(`This wallet holds ${(Number(balance) / 1e9).toFixed(4)} SOL; the launch needs about ${(Number(needed) / 1e9).toFixed(3)} SOL`);
  // every CA ends in `ipo`: the pool is checked BEFORE the image is pinned (so refusing costs nothing) and a key taken after
  if (vanity.REQUIRED && !vanity.hasReservation(launcher) && vanity.available() === 0) throw new ApiError('No launch address is ready right now. Try again in a few minutes.', 503);
  checkUnfinished(launcher, ip);
  const shownImage = images.storeImage(image.bytes);
  const meta = await publishMetadata({ image, form, shownImage });
  let mint = vanity.issueKey(launcher, ip);
  // the launcher's reserved key may already carry their previous launch: then it is spent, issue another
  for (let i = 0; mint && i < 3 && (await sol.conn.getAccountInfo(mint.publicKey, 'confirmed')); i++) { vanity.markLaunched(mint.publicKey.toBase58()); mint = vanity.issueKey(launcher, ip); }
  if (!mint && !vanity.REQUIRED) mint = Keypair.generate();
  if (mint) noteStarted(launcher, ip, mint.publicKey.toBase58(), shownImage);
  if (!mint) throw new ApiError('No pump address is ready right now. Try again in a few minutes.', 503);
  const m = mint.publicKey.toBase58();
  const prior = one('SELECT * FROM launches WHERE mint = ?', m);
  if (prior && (prior.launcher !== launcher || !['prepared', 'failed'].includes(prior.status))) throw new ApiError('This launch is already in progress. Start again in 15 minutes.', 409);
  // A row marked failed whose coin is on chain after all (a lost answer) is the live coin: never deleted or re-prepared.
  if (inFlight.has(m)) throw new ApiError('This launch is being sent right now.', 409);
  const landed = prior ? await onChain(m).catch(() => { throw new ApiError('Could not read the chain just now. Try again in a moment.', 503); }) : false;
  if (landed) { markLive(prior, prior.sig); throw new ApiError('This coin already exists on chain. It is live on the board.', 409); }
  let tx, hash, expectedTokens = 0n, extra = {};
  if (win) {
    const b = await window.build({ launcher, name: form.name, symbol: form.symbol, uri: meta.uri, window: { ...win, holderRewards: form.holderRewards }, mint, devBuyLamports: form.devBuyLamports, pair, tickerFee: tickerFeeDue ? { to: feeTo, lamports: TICKER_FEE_LAMPORTS } : null });
    tx = b.tx; hash = msgHash(tx); extra = { pool: b.pool, config: b.config };
  } else {
    if (tickerFeeDue) throw new ApiError('This ticker launched here in the last 24 hours. Launch it from the launch form.', 409);
    ({ tx, hash, expectedTokens } = await buildLaunchTx({ mint, launcher, form, uri: meta.uri }));
  }
  // Simulated BEFORE the wallet is asked to sign: whatever pump.fun would refuse is refused here, with a reason.
  const sim = await sol.conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true }).catch(() => null);
  if (sim?.value?.err) {
    const why = JSON.stringify(sim.value.err), logs = (sim.value.logs || []).join(' ');
    console.error(`[launch] prepare simulation failed for ${m}: ${why} ${(sim.value.logs || []).slice(-3).join(' | ').slice(0, 300)}`);
    throw new ApiError(/InsufficientFunds|insufficient lamports/i.test(why + logs) ? 'This launch would be refused on chain: the wallet does not hold enough SOL for it. Nothing was sent.' : `This launch would be refused on chain (${why.slice(0, 120)}). Nothing was sent.`, 400);
  }
  // ⛔ checked AGAIN with no await between the check and the insert (sqlite is synchronous): two wallets preparing the same
  //    ticker at once both passed the first check seconds ago; only the first to reach this line gets a row
  // no await from here to the insert: another launch of this ticker landed while this one was being built, so its transaction has no fee
  if (!tickerFeeDue && tickerFeeUntil(form.symbol)) throw new ApiError(`$${form.symbol} just launched here, so launching it now costs 1 SOL. Press launch again. Nothing was sent.`, 409);
  if (inFlight.has(m)) throw new ApiError('This launch is being sent right now.', 409);
  // replaced only now: a refused or failed build leaves the earlier prepared launch signable
  run("DELETE FROM launches WHERE mint = ? AND status IN ('prepared', 'failed')", m);
  if (win) window.recordPair(m, pair); // here, or a failed re-prepare rewrites the pair of the launch that is still signable
  run(`INSERT INTO launches (mint, launcher, name, symbol, description, image, metadata_uri, socials_json, dev_buy_lamports, tx_hash, mint_secret, status, created_at, bumped_at, updated_at, kind, pool, config, size_sol, open_secs, window_minutes, holder_rewards, ticker_fee)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  m, launcher, form.name, form.symbol, form.description, shownImage, meta.uri, JSON.stringify(form.socials), String(form.devBuyLamports), hash, JSON.stringify([...mint.secretKey]), now(), now(), now(),
  win ? 'window' : 'pump', extra.pool ?? null, extra.config ?? null, win?.sizeSol ?? null, win?.openSecs ?? null, win?.windowMinutes ?? null, form.holderRewards ? 1 : 0, tickerFeeDue ? 1 : 0);
  if (body.official === true) run("UPDATE launches SET origin = 'official' WHERE mint = ?", m);
  return { mint: m, kind: win ? 'window' : 'pump', config: extra.config ?? null, tickerFeeSol: tickerFeeDue ? 1 : 0, transaction: sol.b64(tx), expectedTokens: String(expectedTokens), costSol: Number(win ? WINDOW_DEPLOY_COST_LAMPORTS : DEPLOY_COST_LAMPORTS) / 1e9 };
}

function markLive(row, sig) {
  vanity.markLaunched(row.mint);
  if (row.kind === 'window') registerWindow(row);
  // a test launch made while launching is closed never reaches the board: only a direct link finds it
  const tested = !launchOpen() && launchAllowed(row.launcher) && row.origin !== 'official';
  run(`UPDATE launches SET status = '${tested ? 'hidden' : 'live'}', sig = COALESCE(?, sig), mint_secret = NULL, error = NULL, live_at = COALESCE(live_at, ?), bumped_at = ?, updated_at = ? WHERE mint = ?`, sig, now(), now(), now(), row.mint);
  if (sig) run('INSERT OR IGNORE INTO trades (sig, mint, wallet, side, lamports, token_units, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', sig, row.mint, row.launcher, 'create', row.dev_buy_lamports, '0', now());
  if (row.origin === 'official') {
    run("UPDATE launches SET origin = 'external' WHERE origin = 'official' AND mint <> ?", row.mint);
    setKv('officialLive', { mint: row.mint, at: now() });
    setKv('launchOpen', true);
    console.log(`[launch] official coin ${row.mint} landed: launching is OPEN`);
  }
}

/** A landed window launch goes into the graduator's ledger; a lagging RPC read is retried until the rules are readable. */
const registering = new Map();
function registerWindow(row) {
  if (registering.has(row.mint)) return registering.get(row.mint);
  const job = (async () => {
    for (let i = 0; i < 30; i++) {
      try { if (await window.register(row)) return true; } catch (e) { console.error('[window] register', row.mint, e.message); }
      await sol.sleep(1000);
    }
    return false;
  })().finally(() => registering.delete(row.mint));
  registering.set(row.mint, job);
  return job;
}
/** Whether the coin exists on chain: pump.fun's bonding curve, or (window launch) the hook's rules account. */
export const onChain = async (mint) => {
  const r = one('SELECT kind FROM launches WHERE mint = ?', mint);
  if (r?.kind === 'window') return window.onChain(mint);
  // the program's own account: anyone can send SOL to the address, which makes an account there but not a coin
  const info = await sol.conn.getAccountInfo(bondingCurveAddress(new PublicKey(mint)), 'confirmed');
  return Boolean(info && info.owner.equals(PUMP) && info.data.length > 0);
};

const inFlight = new Set();
const sigLanded = async (sig) => { if (!sig) return false; const st = (await sol.conn.getSignatureStatuses([sig], { searchTransactionHistory: true })).value[0]; return Boolean(st && !st.err && st.confirmationStatus !== 'processed'); };
let lastGc = 0;
export async function submit({ mint, transaction }) {
  const row = one('SELECT * FROM launches WHERE mint = ?', String(mint || ''));
  if (!row) throw new ApiError('Unknown launch', 404);
  if (row.status === 'live') return { mint, status: 'live', sig: row.sig };
  if (!['prepared', 'failed', 'created'].includes(row.status)) throw new ApiError('This launch cannot be sent.', 409);
  const tx = sol.parseTx(transaction, 'The launch');
  checkLaunchTx(tx, row);
  // anti-vamp, last look before anything is sent: a coin with this ticker landed while this one was being signed
  // the transaction was built free, but the ticker landed while it was being signed: it must pay like any other copy
  if (!row.sig && !row.ticker_fee && tickerFeeUntil(row.symbol)) throw new ApiError(`$${row.symbol} launched here while you were signing, so launching it now costs 1 SOL. Press launch again. Nothing was sent.`, 409);
  if (inFlight.has(mint)) throw new ApiError('This launch is already being sent.', 409);
  inFlight.add(mint);
  try {
    const sig0 = bs58.encode(tx.signatures[0]);
    // on the books before it can land: a restart or an RPC outage during the send never loses a coin, and reconcile finds it by this signature
    run("UPDATE launches SET status = 'created', sig = ?, updated_at = ? WHERE mint = ? AND status <> 'live'", sig0, now(), mint);
    let sig;
    try {
      sig = await sol.sendSigned(tx, 'The launch');
    } catch (e) {
      if (await sigLanded(sig0).catch(() => false) && await onChain(mint).catch(() => false)) { markLive(row, sig0); return { mint, status: 'live', sig: sig0 }; }
      const definite = e.stage === 'refused' || e.stage === 'failed' || e.stage === 'expired';
      run("UPDATE launches SET status = ?, sig = ?, error = ?, updated_at = ? WHERE mint = ? AND status <> 'live'", definite ? 'failed' : 'created', sig0, e.message.slice(0, 300), now(), mint);
      if (definite) throw e;
      // Unknown: the transaction may still land; the coin page shows it as confirming and reconcile() settles it.
      return { mint, status: 'created', sig: sig0, note: e.message };
    }
    run("UPDATE launches SET status = 'created', sig = ?, updated_at = ? WHERE mint = ? AND status <> 'live'", sig, now(), mint);
    if (await onChain(mint).catch(() => false)) markLive(row, sig);
    else for (let i = 0; i < 8; i++) { // a lagging RPC node: reconcile would only catch it 30 to 60 s later
      await sol.sleep(1000);
      if (await onChain(mint).catch(() => false)) { markLive(row, sig); break; }
    }
    const st = one('SELECT status FROM launches WHERE mint = ?', mint).status;
    if (row.kind === 'window' && st === 'live') await registerWindow(row);
    return { mint, status: st, sig };
  } finally {
    inFlight.delete(mint);
  }
}

/** A row left 'created' (a submit that died after the send) goes live once the chain shows the curve. */
export async function reconcile() {
  let n = 0;
  for (const r of (await import('./db.mjs')).all("SELECT * FROM launches WHERE status = 'created' AND updated_at < ?", now() - 30_000)) {
    try {
      if (await sigLanded(r.sig) && await onChain(r.mint)) { markLive(r, r.sig); n++; }
      else if (now() - r.updated_at > 10 * 60_000) run("UPDATE launches SET status = 'failed', error = 'never landed', updated_at = ? WHERE mint = ?", now(), r.mint);
    } catch {}
  }
  for (const r of (await import('./db.mjs')).all("SELECT * FROM launches WHERE status = 'failed' AND sig IS NOT NULL AND updated_at > ?", now() - 3_600_000)) {
    try { if (await sigLanded(r.sig) && await onChain(r.mint)) { markLive(r, r.sig); n++; } } catch {}
  }
  // a live window launch the ledger does not know (a restart right after it landed): registered now, never left behind
  for (const r of (await import('./db.mjs')).all("SELECT * FROM launches WHERE kind = 'window' AND status IN ('live', 'hidden')")) {
    if (!window.ledgerHas(r.mint)) { if (await registerWindow(r)) n++; }
  }
  run("UPDATE launches SET status = 'failed', updated_at = ? WHERE status = 'prepared' AND created_at < ?", now(), now() - 30 * 60_000);
  if (now() - lastGc > 6 * 3_600_000) { lastGc = now(); try { images.gc((await import('./db.mjs')).all("SELECT image FROM launches WHERE status IN ('live', 'created', 'prepared', 'hidden')").map((x) => x.image).concat(window.pairIconPaths())); } catch {} }
  return n;
}
