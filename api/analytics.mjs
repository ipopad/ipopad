/**
 * The analytics page's numbers. Read from our own databases, so they cost no RPC: a migrated coin's trades from the history the graduator
 * saved, a coin still on its curve from the trades placed through this site. Only the live reads below touch the network, and only while
 * someone has the page open: the fees waiting on curves, wallet balances, and DexScreener for coins on Pumpfun.
 * Hidden and removed coins are never counted. The official coin launches straight on Pumpfun, so it has its own panel.
 */
import { PublicKey } from '@solana/web3.js';
import { all, one, now } from './db.mjs';
import { env } from './env.mjs';
import * as sol from './sol.mjs';
import * as vanity from './vanity.mjs';
import * as window from './window.mjs';
import { getPool } from '../hk/lib/chain.mjs';
import { feeStepFor, creatorFeeOwed } from '../hk/lib/curve.mjs';
import { LAUNCHED_STATUSES } from '../hk/lib/graduate.mjs';
import { eventsFromJson } from '../hk/lib/settle.mjs';

const DAY = 86_400_000;
const RANGES = { '24h': DAY, '7d': 7 * DAY, '30d': 30 * DAY, all: Infinity };
const toSol = (l) => Number(l) / 1e9;
const big = (v) => { try { return BigInt(v ?? 0); } catch { return 0n; } };
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/** What one migrated coin's saved history adds up to. It never changes once a coin is done, so it is kept. */
const historyMemo = new Map();
function historyOf(l) {
  const done = l.status === 'done';
  if (done && historyMemo.has(l.mint)) return historyMemo.get(l.mint);
  const trades = [], wallets = new Set();
  let events = [];
  try { events = eventsFromJson(l.events_json); } catch {}
  for (const e of events) {
    if (!e.isSwap || e.time == null) continue;
    const q = big(e.dQuote);
    if (q !== 0n) trades.push([e.time * 1000, toSol(q < 0n ? -q : q)]);
    for (const d of e.deltas ?? []) if (d.owner) wallets.add(d.owner);
  }
  const out = { trades, wallets: [...wallets], lastAt: events.length ? (events[events.length - 1].time ?? 0) * 1000 : null };
  if (done) historyMemo.set(l.mint, out);
  return out;
}

/** The split of one migrated coin's fees, in SOL. Meteora keeps 20% before anyone can claim. */
function feesOf(l) {
  const claimed = big(l.fees_claimed), collected = big(l.creator_fee_paid);
  const claimable = claimed + collected;
  const toCreators = collected + (l.tax_paid ? big(l.tax_creator) : 0n);
  const topUp = big(l.pump_topup), tax = big(l.tax_total), holdersFee = big(l.holders_fee);
  const moreCoins = l.fee_to === 'holders' && tax > topUp ? tax - topUp : 0n;
  const toHolders = topUp + holdersFee + moreCoins;
  const kept = claimable - toCreators - toHolders;
  return { total: toSol(claimable) / 0.8, meteora: (toSol(claimable) / 0.8) * 0.2, creators: toSol(toCreators), holders: toSol(toHolders), platform: Math.max(0, toSol(kept)) };
}

/** Fees waiting on curves right now. One read per coin, so at most the newest 60 and at most every 5 minutes. */
const onCurveFees = sol.shared(async () => {
  const coins = all("SELECT mint, pool, holder_rewards FROM launches WHERE status = 'live' AND kind = 'window' ORDER BY created_at DESC LIMIT 400");
  const live = coins.filter((c) => window.ledgerStatus(c.mint) === 'trading');
  let platformClaim = 0n, creators = 0n, read = 0;
  for (const c of live.slice(0, 60)) {
    const p = await getPool(window.dbc, new PublicKey(c.pool)).catch(() => null);
    if (!p) continue;
    read++;
    const fee = BigInt(p.partnerQuoteFee.toString());
    const step = feeStepFor(window.pairFeeOf(c.mint));
    platformClaim += fee;
    if (step && !c.holder_rewards) creators += creatorFeeOwed({ unclaimed: fee, paid: BigInt(window.creatorPaidOf(c.mint)), creatorPct: step.creatorPct });
    await sol.sleep(150);
  }
  return { sol: toSol(platformClaim), creators: toSol(creators), read, of: live.length };
}, 300_000);

/** What DexScreener says about coins on Pumpfun, 30 to a request, the newest 90. */
const pumpfunStats = sol.shared(async () => {
  const mints = window.migratedMints(90);
  const official = one("SELECT mint FROM launches WHERE origin = 'official' AND status = 'live' ORDER BY live_at DESC LIMIT 1")?.mint;
  const asked = [...new Set([...(official ? [official] : []), ...mints])];
  const out = new Map();
  for (let i = 0; i < asked.length; i += 30) {
    const r = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${asked.slice(i, i + 30).join(',')}`, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(`dexscreener ${r.status}`);
    for (const p of await r.json()) {
      const m = p.baseToken?.address;
      if (!m) continue;
      const was = out.get(m) ?? { volume24h: 0, cap: 0, buys: 0, sells: 0 };
      out.set(m, { volume24h: was.volume24h + (p.volume?.h24 ?? 0), cap: Math.max(was.cap, p.marketCap ?? 0), buys: was.buys + (p.txns?.h24?.buys ?? 0), sells: was.sells + (p.txns?.h24?.sells ?? 0), change24h: was.change24h ?? p.priceChange?.h24 ?? null });
    }
  }
  return out;
}, 300_000);

const balances = sol.shared(async () => {
  const treasury = env('TREASURY', '');
  const [hot, chest] = await Promise.all([sol.conn.getBalance(window.PLATFORM, 'confirmed'), treasury ? sol.conn.getBalance(new PublicKey(treasury), 'confirmed').catch(() => null) : null]);
  return { hot: hot / 1e9, hotWallet: window.PLATFORM.toBase58(), treasury: chest == null ? null : chest / 1e9, treasuryWallet: treasury || null };
}, 60_000);

const CATEGORY_NAMES = { stocks: 'Stocks', crypto: 'Crypto', memes: 'Memes' };

async function build() {
  const t = now();
  const rows = all("SELECT mint, launcher, symbol, name, image, kind, origin, size_sol, holder_rewards, ticker_fee, created_at FROM launches WHERE status = 'live'");
  const coins = rows.filter((r) => r.kind === 'window');
  const ledgerRows = new Map(window.ledger.prepare('SELECT * FROM launches').all().map((l) => [l.mint, l]));
  const pairList = await window.pairsSafe();
  const pairInfo = new Map(pairList.map((p) => [p.mint, p]));
  const siteTrades = all("SELECT mint, wallet, lamports, created_at AS at FROM trades WHERE side IN ('buy', 'sell', 'create')");
  const tradesByMint = new Map();
  for (const x of siteTrades) { if (!tradesByMint.has(x.mint)) tradesByMint.set(x.mint, []); tradesByMint.get(x.mint).push(x); }

  const launches = [], migrations = [], volume = [], feeEvents = [], traders = new Set(), minutes = [];
  const perCoin = [];
  const count = { onCurve: 0, migrating: 0, migrated: 0, ended: 0, stuck: 0 };
  const byPair = new Map(), byPairName = new Map(), byCap = new Map(), byRewards = { creator: 0, holders: 0 };
  let holdersPaid = 0, heldUnits = 0n, sentUnits = 0n, keptLowest = null;
  const launchers = new Set();

  for (const c of coins) {
    launches.push(c.created_at);
    launchers.add(c.launcher);
    const l = ledgerRows.get(c.mint);
    const status = l?.status ?? 'trading';
    const migrated = Boolean(l?.pump_mint) && (LAUNCHED_STATUSES.has(status) || (status === 'stalled' && LAUNCHED_STATUSES.has(l.stalled_from)));
    if (status === 'stalled') count.stuck++;
    if (migrated) count.migrated++;
    else if (status === 'trading') count.onCurve++;
    else if (status === 'done') count.ended++;
    else count.migrating++;

    const pair = l?.pair_mint ? pairInfo.get(l.pair_mint) : null;
    const group = !l?.pair_mint ? 'SOL' : pair?.kind === 'usdc' ? 'USDC' : CATEGORY_NAMES[pair?.category] ?? 'Other';
    byPair.set(group, (byPair.get(group) ?? 0) + 1);
    if (l?.pair_mint) { const n = pair?.symbol ?? l.pair_mint.slice(0, 4); byPairName.set(n, (byPairName.get(n) ?? 0) + 1); }
    if (c.size_sol != null) { const b = byCap.get(c.size_sol) ?? { launches: 0, migrated: 0 }; b.launches++; if (migrated) b.migrated++; byCap.set(c.size_sol, b); }
    byRewards[c.holder_rewards ? 'holders' : 'creator']++;

    // the saved history once the curve filled, else what was traded through this site
    let trades;
    if (l?.events_json) {
      const h = historyOf(l);
      trades = h.trades;
      for (const w of h.wallets) traders.add(w);
    } else {
      trades = (tradesByMint.get(c.mint) ?? []).map((x) => [x.at, toSol(x.lamports)]);
      for (const x of tradesByMint.get(c.mint) ?? []) traders.add(x.wallet);
    }
    for (const x of trades) volume.push(x);
    perCoin.push({ c, l, trades, migrated, pair });

    if (migrated) {
      const at = historyOf(l).lastAt ?? l.updated_at ?? t;
      migrations.push(at);
      if (l.events_json && c.created_at) { const m = (at - c.created_at) / 60_000; if (m >= 0) minutes.push(m); }
      if (l.fees_claimed != null) feeEvents.push({ at, ...feesOf(l) });
      if (l.settle_json) {
        try {
          const s = JSON.parse(l.settle_json);
          holdersPaid += Number(s.holders ?? 0);
          const held = big(s.held), sent = big(s.toHolders);
          if (held > 0n) {
            heldUnits += held; sentUnits += sent;
            const kept = Number((sent * 10_000n) / held) / 100;
            if (keptLowest == null || kept < keptLowest) keptLowest = kept;
          }
        } catch {}
      }
    }
  }

  const inRange = (at, span) => t - at <= span;
  const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0);
  const ranges = {};
  for (const [k, span] of Object.entries(RANGES)) {
    const fees = feeEvents.filter((f) => inRange(f.at, span));
    const vol = volume.filter((x) => inRange(x[0], span));
    const top = perCoin.map(({ c, l, trades, migrated, pair }) => {
      const t2 = trades.filter((x) => inRange(x[0], span));
      return { mint: c.mint, name: c.name, symbol: c.symbol, image: c.image, pair: pair?.symbol ?? (l?.pair_mint ? l.pair_mint.slice(0, 4) : 'SOL'), migrated, volume: sum(t2, (x) => x[1]), trades: t2.length };
    }).filter((x) => x.trades > 0).sort((a, b) => b.volume - a.volume).slice(0, 10);
    ranges[k] = {
      volume: sum(vol, (x) => x[1]), trades: vol.length, launches: launches.filter((at) => inRange(at, span)).length, migrations: migrations.filter((at) => inRange(at, span)).length,
      fees: sum(fees, (f) => f.total), revenue: sum(fees, (f) => f.platform),
      split: { creators: sum(fees, (f) => f.creators), holders: sum(fees, (f) => f.holders), meteora: sum(fees, (f) => f.meteora), platform: sum(fees, (f) => f.platform) },
      top,
    };
  }

  // one row per day from the first launch to today, so a quiet day shows as a gap
  let first = t; // a loop: spreading a long list into Math.min throws
  for (const at of launches) if (at < first) first = at;
  for (const x of volume) if (x[0] < first) first = x[0];
  const days = new Map();
  for (let d = Date.parse(`${dayOf(first)}T00:00:00Z`); d <= t; d += DAY) days.set(dayOf(d), { day: dayOf(d), volume: 0, launches: 0, migrations: 0, fees: 0, revenue: 0 });
  const add = (at, k, v) => { const d = days.get(dayOf(at)); if (d) d[k] += v; };
  for (const x of volume) add(x[0], 'volume', x[1]);
  for (const at of launches) add(at, 'launches', 1);
  for (const at of migrations) add(at, 'migrations', 1);
  for (const f of feeEvents) { add(f.at, 'fees', f.total); add(f.at, 'revenue', f.platform); }

  const [waiting, pump] = await Promise.all([onCurveFees().catch(() => null), pumpfunStats().catch(() => null)]);
  const officialRow = rows.find((r) => r.origin === 'official') ?? null;
  const pumpMints = perCoin.map((x) => x.l?.pump_mint).filter(Boolean);
  const onPumpfun = pump ? pumpMints.reduce((a, m) => { const s = pump.get(m); return s ? { volume24h: a.volume24h + s.volume24h, cap: a.cap + s.cap, trades24h: a.trades24h + s.buys + s.sells } : a; }, { volume24h: 0, cap: 0, trades24h: 0 }) : null;
  const tickerFees = coins.filter((c) => c.ticker_fee).length;

  return {
    at: t,
    solUsd: await sol.solUsd().catch(() => null),
    ranges,
    series: [...days.values()],
    coins: { ...count, total: coins.length, migrationRate: coins.length ? count.migrated / coins.length : null, medianMinutes: median(minutes) },
    byPair: [...byPair].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n),
    topPairs: [...byPairName].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n).slice(0, 6),
    byCap: [...byCap].map(([size, v]) => ({ size, ...v })).sort((a, b) => a.size - b.size),
    byRewards,
    people: { creators: launchers.size, traders: traders.size },
    holders: { paid: holdersPaid, keptPct: heldUnits > 0n ? Number((sentUnits * 10_000n) / heldUnits) / 100 : null, keptLowest },
    waiting,
    onPumpfun,
    tickerFees: { coins: tickerFees, sol: tickerFees },
    official: officialRow ? { mint: officialRow.mint, name: officialRow.name, symbol: officialRow.symbol, image: officialRow.image, ...(pump?.get(officialRow.mint) ?? {}) } : null,
  };
}

export const analytics = sol.shared(build, 60_000);

/** Operations, for the operator alone (deploy/ops.sh, /api/ops answers only on the box itself). */
export async function opsReport() {
  const ledgerRows = window.ledger.prepare("SELECT status, COUNT(*) AS n FROM launches GROUP BY status").all();
  const by = Object.fromEntries(ledgerRows.map((r) => [r.status, r.n]));
  const failedPushes = window.ledger.prepare("SELECT COUNT(*) AS n FROM pushes WHERE status = 'failed'").get().n;
  const moving = Object.entries(by).filter(([k]) => !['trading', 'done', 'stalled'].includes(k)).reduce((a, [, n]) => a + n, 0);
  return { at: new Date().toISOString(), ...(await balances({ fresh: true })), addressesReady: vanity.available(), addressesFresh: vanity.freshCount(), onCurve: by.trading ?? 0, migrating: moving, done: by.done ?? 0, needsAttention: by.stalled ?? 0, failedPushes };
}
