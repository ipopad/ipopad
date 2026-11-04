// The HTTP API and the built site, in one Node process.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { num, PROD, ROOT } from './env.mjs';
import { ApiError } from './errors.mjs';
import * as sol from './sol.mjs';
import * as launch from './launch.mjs';
import * as trade from './trade.mjs';
import * as coins from './coins.mjs';
import * as images from './images.mjs';
import * as vanity from './vanity.mjs';
import * as window from './window.mjs';
import { analytics, opsReport } from './analytics.mjs';
import * as history from './history.mjs';

const PORT = num('PORT', 5560);
const DIST = path.join(ROOT, 'web', 'dist');
const MAX_BODY = 2 * 1024 * 1024, SMALL_BODY = 128 * 1024;
process.on('unhandledRejection', (e) => console.error('[api] unhandled', e));

/* ───────────── rate limits (per IP, in memory) ───────────── */
const buckets = new Map();
function limit(ip, key, perWindow, windowMs) {
  const k = `${key}:${ip}`, b = buckets.get(k), t = Date.now();
  if (!b || t - b.start > windowMs) { buckets.set(k, { start: t, n: 1 }); return; }
  if (++b.n > perWindow) throw new ApiError('Too many requests, slow down a little', 429);
}
setInterval(() => { const t = Date.now(); for (const [k, b] of buckets) if (t - b.start > 3_600_000) buckets.delete(k); }, 600_000).unref();

/* ───────────── plumbing ───────────── */
function send(res, status, body, headers = {}) {
  const json = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, { 'content-type': json ? 'application/json; charset=utf-8' : headers['content-type'] || 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers });
  res.end(json ? JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? String(v) : v)) : body);
}
async function readBody(req, max = MAX_BODY) {
  const parts = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > max) throw new ApiError(`Request body is over ${Math.round(max / 1024 / 1024)} MB`, 413);
    parts.push(c);
  }
  const raw = Buffer.concat(parts);
  if (!raw.length) return {};
  let v;
  try { v = JSON.parse(raw.toString('utf8')); } catch { throw new ApiError('Body must be JSON'); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ApiError('Body must be a JSON object');
  return v;
}

const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), fn });
const mintOf = (p) => sol.requireMint(p.mint).toBase58();

// ?wallet=<address>: launchOpen is true for a wallet allowed to launch while the gate is closed (the operator's test launch)
// asked on the box itself: Caddy always adds x-forwarded-for, so nothing from outside can look local
const isLocal = (req) => !req.headers['x-forwarded-for'] && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
route('GET', '/api/config', async ({ query, req }) => ({
  launchReady: launch.configured(), launchOpen: launch.launchOpen() || launch.launchAllowed(query.get('wallet')) || launch.officialAllowed(query.get('wallet')), officialLaunch: launch.officialAllowed(query.get('wallet')), officialPreset: launch.officialAllowed(query.get('wallet')) ? launch.OFFICIAL_PRESET : null, windowOnly: launch.WINDOW_ONLY, publicUrl: launch.PUBLIC_URL, official: coins.official(), devBuyReady: await launch.devBuyReady(), maxDevBuySol: launch.MAX_DEV_BUY_SOL, deployCostSol: Number(launch.DEPLOY_COST_LAMPORTS) / 1e9,
  vanity: { ready: !vanity.REQUIRED || vanity.available() > 0, required: vanity.REQUIRED, suffix: vanity.SUFFIX, launchSuffix: vanity.LAUNCH_SUFFIX, ...(isLocal(req) ? { available: vanity.available(), fresh: vanity.freshCount(), reserve: vanity.GRADUATION_RESERVE } : {}) }, explorer: sol.EXPLORER, solUsd: await sol.solUsd().catch(() => null),
  tickerFee: { sol: 1, hours: 24 },
  limits: { name: launch.NAME_MAX, symbol: launch.SYMBOL_MAX, description: launch.DESCRIPTION_MAX },
  window: { firstBuyMaxSol: await window.firstBuyMaxLamports().then((l) => (l == null ? null : Number(l) / 1e9)).catch(() => null), firstBuyMaxPct: window.FIRST_BUY_MAX_SUPPLY_PCT, ready: await window.ready().catch(() => false), sizes: await window.sizes().catch(() => []), limits: window.LIMITS, platform: window.PLATFORM.toBase58(), hookProgram: window.HOOK_PROGRAM.toBase58(), deployCostSol: Number(launch.WINDOW_DEPLOY_COST_LAMPORTS) / 1e9, rules: true },
}));
route('GET', '/api/status', async () => ({ launchOpen: launch.launchOpen() })); // no RPC: every waiting visitor polls it
route('GET', '/api/health', async ({ req }) => (isLocal(req) ? { ok: true, rpc: sol.rpcUsage(), vanityFresh: vanity.freshCount(), vanityLaunchFresh: vanity.freshLaunchCount(), launchReady: launch.configured() } : { ok: true }));
route('GET', '/api/ops', async ({ req }) => { if (!isLocal(req)) throw new ApiError('Not found', 404); return opsReport(); });
route('GET', '/api/coins', async ({ query }) => coins.list({ sort: query.get('sort') || 'bump', order: query.get('order') || 'desc', q: query.get('q') || '' }));
route('GET', '/api/stats', async () => coins.stats());
route('GET', '/api/ticker', async () => coins.ticker());
route('GET', '/api/analytics', async ({ ip }) => { limit(ip, 'analytics', 120, 60_000); return analytics(); });
route('GET', '/api/pairs/:mint', async ({ params, ip }) => { limit(ip, 'pairlookup', 60, 600_000); try { return await window.lookup(String(params.mint)); } catch (e) { if (e.transient) return { ok: false, why: e.message }; throw e; } });
route('GET', '/api/pairs/:mint/curve', async ({ params, ip }) => { limit(ip, 'paircurve', 60, 600_000); return window.pairCurve(String(params.mint)); });
route('GET', '/api/pairs', async () => ({ pairs: (await window.pairs().catch(() => [])).map((p) => ({ mint: p.mint, symbol: p.symbol, name: p.name, icon: p.icon, liquidity: p.liquidity, mcap: p.mcap ?? 0, verified: Boolean(p.verified), category: p.category ?? 'crypto', kind: p.kind ?? 'control' })), maxCreatorFeeBps: window.MAX_CREATOR_FEE_BPS }));
route('GET', '/api/coins/:mint', async ({ params }) => coins.coin(mintOf(params)));
// the chart and the trades tab, from the chain: indexes what is new first (rate-limited per coin), then answers
route('GET', '/api/coins/:mint/chart', async ({ params, ip, query }) => { limit(ip, 'chart', 240, 600_000); const m = mintOf(params); const c = await coins.coin(m); /* 404 unless listed: never index a stranger's coin */ history.index(m); return { ...history.chart(m, c?.priceSol ?? null, query.get('interval')), supply: c?.capSol && c?.priceSol ? c.capSol / c.priceSol : 1e9 }; });
route('POST', '/api/coins/:mint/creator-fee', async ({ params, body, ip }) => { limit(ip, 'creatorfee', 20, 600_000); return window.collectFee({ mint: mintOf(params), wallet: String(body.wallet || ''), ts: body.ts, signature: body.signature }); });
route('GET', '/api/launch/ticker', async ({ query, ip }) => { limit(ip, 'tickercheck', 240, 600_000); return launch.tickerStatus(query.get('symbol')); });
route('POST', '/api/launch/prepare', async ({ body, ip }) => { limit(ip, 'prepare', 30, 60_000); return launch.prepare(body, ip); });
route('POST', '/api/launch/submit', async ({ body, ip }) => { limit(ip, 'submit', 30, 60_000); return launch.submit(body); });
route('POST', '/api/launch/list', async ({ body, ip }) => { limit(ip, 'list', 60, 600_000); return window.listTxs({ mint: String(body.mint || ''), creator: String(body.wallet || ''), wallets: body.wallets, seal: body.seal }); });
route('POST', '/api/launch/list/submit', async ({ body, ip }) => { limit(ip, 'listsubmit', 120, 600_000); return window.submitList({ mint: String(body.mint || ''), transaction: body.transaction }); });
route('POST', '/api/trade/prepare', async ({ body, ip }) => { limit(ip, 'trade', 60, 600_000); return trade.prepare(body); });
route('POST', '/api/trade/submit', async ({ body, ip }) => { limit(ip, 'tsubmit', 60, 600_000); return trade.submit(body); });

/* ───────────── static site ───────────── */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp', '.json': 'application/json', '.txt': 'text/plain', '.woff2': 'font/woff2' };
function serveStatic(req, res, pathname) {
  if (!fs.existsSync(DIST)) { send(res, 503, 'The site is not built yet (npm run build).'); return; }
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { send(res, 404, 'Not found'); return; }
  let file = path.join(DIST, path.normalize(decoded).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(DIST)) { send(res, 404, 'Not found'); return; }
  const isAsset = pathname.startsWith('/assets/');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (isAsset) { send(res, 404, 'Not found'); return; } // a missing hashed bundle is 404, never the index at 200
    file = path.join(DIST, 'index.html');
  }
  const ext = path.extname(file);
  // index.html is never cached (a returning visitor must get the new bundle names); hashed assets forever.
  res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': isAsset ? 'public, max-age=31536000, immutable' : 'no-store', 'x-content-type-options': 'nosniff' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const seen = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
  const ip = seen.includes(':') && !seen.startsWith('::ffff:') ? seen.split(':').slice(0, 4).join(':') : seen; // one IPv6 customer holds a whole /64
  let url;
  try { url = new URL(req.url, 'http://x'); } catch { send(res, 400, 'Bad request'); return; }
  try {
    if (url.pathname.startsWith('/api/logos/')) {
      if (!images.serveLogo(res, url.pathname.slice('/api/logos/'.length))) send(res, 404, 'Not found');
      return;
    }
    // the token metadata this site hosts (immutable, content-hashed): what the chain's URIs point at
    if (url.pathname.startsWith('/meta/')) { if (!launch.serveMetadata(res, url.pathname.slice(6))) send(res, 404, 'Not found'); return; }
    if (url.pathname.startsWith('/img/')) { if (!images.serveOriginal(res, url.pathname.slice(5))) send(res, 404, 'Not found'); return; }
    for (const r of routes) {
      const m = url.pathname.match(r.re);
      if (!m || r.method !== req.method) continue;
      // limited before the body is read: only a launch carries an image
      const big = url.pathname === '/api/launch/prepare';
      if (req.method === 'POST') limit(ip, big ? 'bodybig' : 'body', big ? 30 : 240, 60_000);
      const body = req.method === 'POST' ? await readBody(req, big ? MAX_BODY : SMALL_BODY) : {};
      const out = await r.fn({ req, res, params: m.groups || {}, query: url.searchParams, body, ip });
      if (!res.headersSent) send(res, 200, out ?? {});
      return;
    }
    if (url.pathname.startsWith('/api/')) { send(res, 404, { error: 'Not found' }); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { send(res, 405, 'Method not allowed'); return; }
    serveStatic(req, res, url.pathname);
  } catch (e) {
    if (e instanceof ApiError) { send(res, e.status, { error: e.message, stage: e.stage ?? null }); return; }
    console.error(`[api] ${req.method} ${url.pathname}:`, e);
    send(res, 500, { error: 'Something went wrong on our side. Try again in a moment.' });
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`[ipo] listening on http://127.0.0.1:${PORT} (${PROD ? 'production' : 'dev'}) rpc=${new URL(sol.RPC_URL).host} launch=${launch.configured() ? 'ready' : 'NOT CONFIGURED'} vanity=${vanity.freshCount()} fresh`));

/* ───────────── background ───────────── */
vanity.importIncoming();
setInterval(() => { try { const n = vanity.importIncoming(); if (n) console.log(`[vanity] imported ${n} key(s), ${vanity.freshCount()} fresh`); } catch (e) { console.error('[vanity]', e.message); } }, 15_000).unref();
setInterval(() => launch.reconcile().catch((e) => console.error('[reconcile]', e.message)), 30_000).unref();
setInterval(() => trade.settlePending().catch((e) => console.error('[settle]', e.message)), 30_000).unref();
setInterval(() => coins.samplePass().catch((e) => console.error('[sample]', e.message)), 60_000).unref();
setTimeout(() => coins.samplePass().catch(() => {}), 5_000).unref();
