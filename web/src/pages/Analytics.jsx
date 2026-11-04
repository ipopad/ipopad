import { useEffect, useMemo, useState } from 'react';
import { Link } from '../lib/router.js';
import { api } from '../lib/api.js';
import { usdK, count } from '../lib/format.js';

const RANGES = [['24h', '24h'], ['7d', '7d'], ['30d', '30d'], ['all', 'All']];
const METRICS = [
  { id: 'volume', t: 'Volume', label: 'Curve volume', money: true },
  { id: 'launches', t: 'Launches', label: 'Launches' },
  { id: 'migrations', t: 'Migrations', label: 'Migrated to Pumpfun' },
  { id: 'fees', t: 'Fees', label: 'Fees', money: true },
  { id: 'revenue', t: 'Revenue', label: 'Protocol revenue', money: true },
];
const solText = (n) => (n == null ? '–' : `${n.toLocaleString('en-US', { maximumFractionDigits: n >= 100 ? 0 : n >= 1 ? 2 : 4 })} SOL`);
const pct = (n, dp = 1) => (n == null ? '–' : `${n.toFixed(dp)}%`);
const dayText = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
/** The next round number at or above n: 1, 2, 5 times a power of ten. */
const niceTop = (n) => { const p = 10 ** Math.floor(Math.log10(n)); return [1, 2, 5, 10].find((k) => k * p >= n) * p; };

function Stat({ label, value, sub, bar }) {
  return <div className="an-stat"><div className="an-l">{label}</div><div className="an-v">{value}</div>{sub && <div className="an-s">{sub}</div>}{bar != null && <span className="an-meter"><i style={{ width: `${Math.min(100, bar)}%` }} /></span>}</div>;
}
const Stats = ({ n, children }) => <div className="an-stats" style={{ '--n': n }}>{children}</div>;

/** Daily bars, one series, on round gridlines. A wide hit area on each day and a tooltip on hover. */
function Bars({ days, metric, fmt, unit }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(...days.map((d) => d[metric]), 0);
  const top = max > 0 ? niceTop(max * unit) / unit : 1;
  const ticks = max === 0 ? [0] : !unit || (unit === 1 && top < 2) ? [top, 0] : [top, top / 2, 0];
  const shown = hover != null ? days[hover] : null;
  const labelEvery = Math.max(1, Math.ceil(days.length / 6));
  return (
    <div className="an-chart" role="img" aria-label={`daily ${metric}, highest ${fmt(max)}`}>
      <div className="an-plot">
        <div className="an-grid">{ticks.map((v) => <div key={v} className="an-tick" style={{ bottom: `${(v / top) * 100}%` }}><span>{fmt(v)}</span></div>)}</div>
        <div className="an-bars" onMouseLeave={() => setHover(null)}>
          {days.map((d, i) => (
            <div key={d.day} className={`an-col${hover === i ? ' on' : ''}`} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
              <i style={{ height: d[metric] > 0 ? `max(3px, ${(d[metric] / top) * 100}%)` : 0 }} />
            </div>
          ))}
          {shown && <div className="an-tip" style={{ left: `${Math.min(90, Math.max(10, ((hover + 0.5) / days.length) * 100))}%` }}><b>{fmt(shown[metric])}</b><span>{dayText(shown.day)}</span></div>}
        </div>
        {max === 0 && <div className="an-empty">nothing to show here yet</div>}
      </div>
      <div className="an-axis">{days.map((d, i) => <span key={d.day}>{(days.length - 1 - i) % labelEvery === 0 ? dayText(d.day) : ''}</span>)}</div>
    </div>
  );
}

function Rows({ rows, empty = 'nothing yet' }) {
  const max = Math.max(...rows.map((r) => r.n), 0);
  if (!rows.length || max === 0) return <div className="muted sm an-none">{empty}</div>;
  return (
    <div className="an-rows">
      {rows.map((r) => (
        <div key={r.name} className="an-row">
          <div className="an-row-top"><span className="an-rn">{r.name}</span><span className="an-rv">{r.text ?? count(r.n)}</span></div>
          <span className="an-track"><i style={{ width: `${(r.n / max) * 100}%` }} /></span>
        </div>
      ))}
    </div>
  );
}

export default function Analytics() {
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const [range, setRange] = useState('7d');
  const [metric, setMetric] = useState('volume');

  useEffect(() => {
    let alive = true;
    const load = () => api.analytics().then((x) => { if (alive) { setD(x); setError(null); } }).catch((e) => { if (alive && !e.network) setError(e.message); });
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const usd = (s) => (d?.solUsd ? usdK(s * d.solUsd) : solText(s));
  // always a full window: a young site's few days sit at the right edge, not stretched across the chart
  const days = useMemo(() => {
    if (!d) return [];
    const n = range === 'all' ? Math.max(d.series.length, 7) : range === '30d' ? 30 : 7;
    const shown = d.series.slice(-n);
    const last = Date.parse(`${shown[shown.length - 1]?.day ?? new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    const missing = Array.from({ length: n - shown.length }, (_, i) => ({ day: new Date(last - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10), volume: 0, launches: 0, migrations: 0, fees: 0, revenue: 0 }));
    return shown.length ? [...missing, ...shown] : [...missing.slice(1), { ...missing[0], day: new Date(last).toISOString().slice(0, 10) }];
  }, [d, range]);

  if (!d) return <main className="wrap"><div className="page-head"><h1><span className="grad">Analytics</span></h1></div>{error ? <div className="err">{error}</div> : <div className="empty">loading…</div>}</main>;

  const r = d.ranges[range];
  const m = METRICS.find((x) => x.id === metric);
  const fmt = m.money ? usd : (v) => count(Math.round(v));
  const splitTotal = r.split.creators + r.split.holders + r.split.meteora + r.split.platform;
  const splitRow = (name, v) => ({ name, n: v, text: `${usd(v)}${splitTotal > 0 ? ` (${Math.round((v / splitTotal) * 100)}%)` : ''}` });
  const rewardsTotal = d.byRewards.creator + d.byRewards.holders;

  return (
    <main className="wrap an">
      <div className="an-head">
        <h1><span className="grad">Analytics</span></h1>
        <div className="an-seg">
          {RANGES.map(([id, t]) => <button key={id} className={range === id ? 'on' : ''} onClick={() => setRange(id)}>{t}</button>)}
        </div>
      </div>

      <section className="panel an-main">
        <div className="an-kpis">
          {METRICS.map((x) => (
            <button key={x.id} className={`an-kpi${metric === x.id ? ' on' : ''}`} aria-pressed={metric === x.id} onClick={() => setMetric(x.id)}>
              <span className="an-l">{x.label}</span>
              <span className="an-v">{x.money ? usd(r[x.id]) : count(r[x.id])}</span>
              <span className="an-s">{x.money ? solText(r[x.id]) : ' '}</span>
            </button>
          ))}
        </div>
        <div className="an-plot-wrap">
          <div className="an-plot-title">{m.t}, {range === 'all' ? 'all time' : `last ${range === '24h' ? '7d' : range}`}</div>
          <Bars days={days} metric={metric} fmt={fmt} unit={m.money ? d.solUsd || 1 : 1} />
        </div>
      </section>

      {d.official && (
        <section className="panel an-official">
          <Link href={`/coin/${d.official.mint}`} className="an-coin big">{d.official.image && <img src={d.official.image} alt="" />}<span><b>${d.official.symbol}</b><span className="muted xs">{d.official.name}</span></span></Link>
          <Stats n={4}>
            <Stat label="Market cap" value={d.official.cap ? usdK(d.official.cap) : '–'} />
            <Stat label="Volume, 24h" value={d.official.volume24h != null ? usdK(d.official.volume24h) : '–'} />
            <Stat label="Trades, 24h" value={d.official.buys != null ? count(d.official.buys + d.official.sells) : '–'} />
            <Stat label="Price, 24h" value={d.official.change24h != null ? `${d.official.change24h > 0 ? '+' : ''}${d.official.change24h}%` : '–'} />
          </Stats>
        </section>
      )}

      <section className="panel">
        <h2 className="an-h center">Top coins by curve volume</h2>
        {r.top.length === 0 ? <div className="muted sm an-none">nothing traded in this period</div> : (
          <div className="an-table-wrap">
            <table className="an-table">
              <thead><tr><th>#</th><th>Coin</th><th>Paired with</th><th className="an-num">Volume</th><th className="an-num">Trades</th><th className="an-num">Where</th></tr></thead>
              <tbody>
                {r.top.map((c, i) => (
                  <tr key={c.mint}>
                    <td className="an-rank">{i + 1}</td>
                    <td><Link href={`/coin/${c.mint}`} className="an-coin">{c.image && <img src={c.image} alt="" />}<span><b>{c.symbol}</b><span className="muted xs">{c.name}</span></span></Link></td>
                    <td className="muted">{c.pair}</td>
                    <td className="an-num hi">{usd(c.volume)}</td>
                    <td className="an-num">{count(c.trades)}</td>
                    <td className="an-num"><span className={`an-where${c.migrated ? ' on' : ''}`}>{c.migrated ? 'On Pumpfun' : 'On curve'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="an-two">
        <section className="panel">
          <h2 className="an-h center">Coins</h2>
          <Stats n={3}>
            <Stat label="Launched" value={count(d.coins.total)} />
            <Stat label="On a curve now" value={count(d.coins.onCurve)} />
            <Stat label="Migration rate" value={d.coins.migrationRate == null ? '–' : pct(d.coins.migrationRate * 100)} />
            <Stat label="Typical time to migrate" value={d.coins.medianMinutes == null ? '–' : d.coins.medianMinutes < 90 ? `${Math.round(d.coins.medianMinutes)} min` : `${(d.coins.medianMinutes / 60).toFixed(1)} h`} />
            <Stat label="Creators" value={count(d.people.creators)} />
            <Stat label="Traders" value={count(d.people.traders)} />
          </Stats>
        </section>
        <section className="panel">
          <h2 className="an-h center">On Pumpfun, last 24h</h2>
          {d.onPumpfun ? (
            <Stats n={3}>
              <Stat label="Volume" value={usdK(d.onPumpfun.volume24h)} />
              <Stat label="Trades" value={count(d.onPumpfun.trades24h)} />
              <Stat label="Combined market cap" value={usdK(d.onPumpfun.cap)} />
            </Stats>
          ) : <div className="muted sm an-none">not readable right now</div>}
        </section>
      </div>

      <div className="an-two">
        <section className="panel">
          <h2 className="an-h center">Launches by pair</h2>
          <Rows rows={d.byPair} />
          {d.topPairs.length > 0 && <><h3 className="an-sub center">most used custom pairs</h3><Rows rows={d.topPairs} /></>}
        </section>
        <section className="panel">
          <h2 className="an-h center">Launches by market cap</h2>
          <Rows rows={d.byCap.map((c) => ({ name: `${c.size} SOL`, n: c.launches, text: `${count(c.launches)} · ${count(c.migrated)} migrated` }))} />
          <h3 className="an-sub center">creator rewards go to</h3>
          <Rows rows={[{ name: 'Creator', n: d.byRewards.creator, text: `${count(d.byRewards.creator)}${rewardsTotal ? ` (${Math.round((d.byRewards.creator / rewardsTotal) * 100)}%)` : ''}` }, { name: 'Holders', n: d.byRewards.holders, text: `${count(d.byRewards.holders)}${rewardsTotal ? ` (${Math.round((d.byRewards.holders / rewardsTotal) * 100)}%)` : ''}` }]} />
        </section>
      </div>

      <div className="an-two">
        <section className="panel">
          <h2 className="an-h center">Where the fees went</h2>
          <Rows rows={[splitRow('Creators', r.split.creators), splitRow('Holders', r.split.holders), splitRow('Protocol', r.split.platform), splitRow('Meteora', r.split.meteora)]} empty="no coin has migrated in this period" />
          {d.waiting && <div className="an-after"><Stats n={2}>
            <Stat label="Fees waiting on curves" value={usd(d.waiting.sol)} />
            <Stat label="Of which creators" value={usd(d.waiting.creators)} />
          </Stats></div>}
          {d.waiting && d.waiting.of > d.waiting.read && <p className="muted xs an-note">the newest {d.waiting.read} of {count(d.waiting.of)} coins on a curve.</p>}
        </section>
        <section className="panel an-hm">
          <div className="an-hm-group">
            <h2 className="an-h center">Holders at migration</h2>
            <Stats n={3}>
              <Stat label="Wallets paid" value={count(d.holders.paid)} />
              <Stat label="Coins received" value={pct(d.holders.keptPct)} sub="of what they held" bar={d.holders.keptPct} />
              <Stat label="Lowest on one coin" value={pct(d.holders.keptLowest)} bar={d.holders.keptLowest} />
            </Stats>
          </div>
          <div className="an-hm-group">
            <h2 className="an-h center">Ticker fees</h2>
            <Stats n={2}>
              <Stat label="Paid for a used ticker" value={count(d.tickerFees.coins)} />
              <Stat label="Collected" value={usd(d.tickerFees.sol)} />
            </Stats>
          </div>
        </section>
      </div>

    </main>
  );
}
