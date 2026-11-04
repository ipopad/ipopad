import { useEffect, useMemo, useState } from 'react';
import { Link } from '../lib/router.js';
import { api } from '../lib/api.js';
import { usdK, ago, pumpLink } from '../lib/format.js';

const RANGES = [['24h', '24h'], ['7d', '7d'], ['30d', '30d'], ['all', 'All']];
const METRICS = [
  { id: 'volume', t: 'Volume', money: true },
  { id: 'launches', t: 'Launches' },
  { id: 'migrations', t: 'Migrations' },
  { id: 'fees', t: 'Fees', money: true },
  { id: 'revenue', t: 'Revenue', money: true },
];
const count = (n) => (n == null ? '–' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}K` : n.toLocaleString('en-US'));
const solText = (n) => (n == null ? '–' : `${n.toLocaleString('en-US', { maximumFractionDigits: n >= 100 ? 0 : n >= 1 ? 2 : 4 })} SOL`);
const pct = (n, dp = 1) => (n == null ? '–' : `${n.toFixed(dp)}%`);

function Stat({ label, value, sub }) {
  return <div className="an-stat"><div className="an-v">{value}</div><div className="an-l">{label}</div>{sub && <div className="an-s">{sub}</div>}</div>;
}

/** Daily bars, one series. A wide hit area on each day and a tooltip on hover; the title above names what is drawn. */
function Bars({ days, metric, fmt }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(...days.map((d) => d[metric]), 0);
  if (!days.length || max === 0) return <div className="empty an-empty">nothing to show here yet</div>;
  const ticks = [max, max * (2 / 3), max / 3];
  const shown = hover != null ? days[hover] : null;
  return (
    <div className="an-chart" role="img" aria-label={`daily ${metric}, highest ${fmt(max)}`}>
      <div className="an-grid">{ticks.map((v) => <div key={v} className="an-tick" style={{ top: `${(1 - v / max) * 100}%` }}><span>{fmt(v)}</span></div>)}</div>
      <div className="an-bars" onMouseLeave={() => setHover(null)}>
        {days.map((d, i) => (
          <div key={d.day} className={`an-col ${hover === i ? 'on' : ''}`} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
            <i style={{ height: d[metric] > 0 ? `max(3px, ${(d[metric] / max) * 100}%)` : 0 }} />
          </div>
        ))}
        {shown && <div className="an-tip" style={{ left: `${((hover + 0.5) / days.length) * 100}%` }}><b>{fmt(shown[metric])}</b><span>{shown.day}</span></div>}
      </div>
      <div className="an-axis"><span>{days[0].day.slice(5)}</span>{days.length > 2 && <span>{days[Math.floor(days.length / 2)].day.slice(5)}</span>}<span>{days[days.length - 1].day.slice(5)}</span></div>
    </div>
  );
}

function Rows({ rows, empty = 'nothing yet' }) {
  const max = Math.max(...rows.map((r) => r.n), 0);
  if (!rows.length || max === 0) return <div className="muted sm">{empty}</div>;
  return (
    <div className="an-rows">
      {rows.map((r) => (
        <div key={r.name} className="an-row">
          <span className="an-rn">{r.name}</span>
          <span className="an-track"><i style={{ width: `${(r.n / max) * 100}%` }} /></span>
          <span className="an-rv">{r.text ?? count(r.n)}</span>
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
    const load = () => api.analytics().then((x) => { if (alive) { setD(x); setError(null); } }).catch((e) => { if (alive) setError(e.message); });
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const usd = (s) => (d?.solUsd ? usdK(s * d.solUsd) : solText(s));
  const days = useMemo(() => {
    if (!d) return [];
    const n = range === 'all' ? d.series.length : range === '30d' ? 30 : range === '7d' ? 7 : 7;
    return d.series.slice(-n);
  }, [d, range]);

  if (!d) return <main className="wrap"><div className="page-head"><h1><span className="grad">Analytics</span></h1></div>{error ? <div className="err">{error}</div> : <div className="empty">loading…</div>}</main>;

  const r = d.ranges[range];
  const m = METRICS.find((x) => x.id === metric);
  const fmt = m.money ? usd : (v) => count(Math.round(v));
  const headline = m.id === 'volume' ? usd(r.volume) : m.id === 'fees' ? usd(r.fees) : m.id === 'revenue' ? usd(r.revenue) : m.id === 'launches' ? count(r.launches) : count(r.migrations);
  const splitTotal = r.split.creators + r.split.holders + r.split.meteora + r.split.platform;
  const splitRow = (name, v) => ({ name, n: v, text: `${usd(v)}${splitTotal > 0 ? ` (${Math.round((v / splitTotal) * 100)}%)` : ''}` });
  const rewardsTotal = d.byRewards.creator + d.byRewards.holders;

  return (
    <main className="wrap an">
      <div className="an-head">
        <h1><span className="grad">Analytics</span></h1>
        <div className="explore-tabs an-ranges">
          {RANGES.map(([id, t]) => <button key={id} className={range === id ? 'on' : ''} onClick={() => setRange(id)}>{t}</button>)}
        </div>
      </div>

      <div className="an-stats">
        <Stat label="Curve volume" value={usd(r.volume)} sub={solText(r.volume)} />
        <Stat label="Launches" value={count(r.launches)} />
        <Stat label="Migrated to Pumpfun" value={count(r.migrations)} />
        <Stat label="Fees" value={usd(r.fees)} sub={solText(r.fees)} />
        <Stat label="Protocol revenue" value={usd(r.revenue)} sub={solText(r.revenue)} />
      </div>

      <section className="panel an-main">
        <div className="an-main-top">
          <div><div className="an-big">{headline}</div><div className="muted sm">{m.t}, {RANGES.find((x) => x[0] === range)[1] === 'All' ? 'all time' : `last ${range}`}</div></div>
          <div className="explore-tabs an-metrics">
            {METRICS.map((x) => <button key={x.id} className={metric === x.id ? 'on' : ''} onClick={() => setMetric(x.id)}>{x.t}</button>)}
          </div>
        </div>
        <Bars days={days} metric={metric} fmt={fmt} />
      </section>

      {d.official && (
        <section className="panel an-official">
          <Link href={`/coin/${d.official.mint}`} className="an-coin">{d.official.image && <img src={d.official.image} alt="" />}<span><b>${d.official.symbol}</b><span className="muted xs">{d.official.name}</span></span></Link>
          <div className="an-stats tight">
            <Stat label="Market cap" value={d.official.cap ? usdK(d.official.cap) : '–'} />
            <Stat label="Volume, 24h" value={d.official.volume24h != null ? usdK(d.official.volume24h) : '–'} />
            <Stat label="Trades, 24h" value={d.official.buys != null ? count(d.official.buys + d.official.sells) : '–'} />
            <Stat label="Price, 24h" value={d.official.change24h != null ? `${d.official.change24h > 0 ? '+' : ''}${d.official.change24h}%` : '–'} />
          </div>
        </section>
      )}

      <div className="an-two">
        <section className="panel">
          <h2 className="an-h">Coins</h2>
          <div className="an-stats tight">
            <Stat label="Launched" value={count(d.coins.total)} />
            <Stat label="On a curve now" value={count(d.coins.onCurve)} />
            <Stat label="Migration rate" value={d.coins.migrationRate == null ? '–' : pct(d.coins.migrationRate * 100)} />
            <Stat label="Typical time to migrate" value={d.coins.medianMinutes == null ? '–' : d.coins.medianMinutes < 90 ? `${Math.round(d.coins.medianMinutes)} min` : `${(d.coins.medianMinutes / 60).toFixed(1)} h`} />
            <Stat label="Creators" value={count(d.people.creators)} />
            <Stat label="Traders" value={count(d.people.traders)} />
          </div>
        </section>
        <section className="panel">
          <h2 className="an-h">On Pumpfun, last 24h</h2>
          {d.onPumpfun ? (
            <div className="an-stats tight">
              <Stat label="Volume" value={usdK(d.onPumpfun.volume24h)} />
              <Stat label="Trades" value={count(d.onPumpfun.trades24h)} />
              <Stat label="Combined market cap" value={usdK(d.onPumpfun.cap)} />
            </div>
          ) : <div className="muted sm">not readable right now</div>}
          <p className="muted xs an-note">every coin migrated from here, from DexScreener. the newest 90.</p>
        </section>
      </div>

      <div className="an-two">
        <section className="panel">
          <h2 className="an-h">Launches by pair</h2>
          <Rows rows={d.byPair} />
          {d.topPairs.length > 0 && <><div className="muted xs an-sub">most used custom pairs</div><Rows rows={d.topPairs} /></>}
        </section>
        <section className="panel">
          <h2 className="an-h">Launches by market cap</h2>
          <Rows rows={d.byCap.map((c) => ({ name: `${c.size} SOL`, n: c.launches, text: `${count(c.launches)} · ${count(c.migrated)} migrated` }))} />
          <div className="muted xs an-sub">creator rewards go to</div>
          <Rows rows={[{ name: 'Creator', n: d.byRewards.creator, text: `${count(d.byRewards.creator)}${rewardsTotal ? ` (${Math.round((d.byRewards.creator / rewardsTotal) * 100)}%)` : ''}` }, { name: 'Holders', n: d.byRewards.holders, text: `${count(d.byRewards.holders)}${rewardsTotal ? ` (${Math.round((d.byRewards.holders / rewardsTotal) * 100)}%)` : ''}` }]} />
        </section>
      </div>

      <section className="panel">
        <h2 className="an-h">Top coins by curve volume</h2>
        {r.top.length === 0 ? <div className="muted sm">nothing traded in this period</div> : (
          <div className="an-table-wrap">
            <table className="an-table">
              <thead><tr><th>#</th><th>Coin</th><th>Paired with</th><th className="an-num">Volume</th><th className="an-num">Trades</th><th>Where</th></tr></thead>
              <tbody>
                {r.top.map((c, i) => (
                  <tr key={c.mint}>
                    <td className="muted">{i + 1}</td>
                    <td><Link href={`/coin/${c.mint}`} className="an-coin">{c.image && <img src={c.image} alt="" />}<span><b>{c.symbol}</b><span className="muted xs">{c.name}</span></span></Link></td>
                    <td>{c.pair}</td>
                    <td className="an-num">{usd(c.volume)}</td>
                    <td className="an-num">{count(c.trades)}</td>
                    <td className="muted">{c.migrated ? 'On Pumpfun' : 'On curve'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="an-two">
        <section className="panel">
          <h2 className="an-h">Where the fees went</h2>
          <Rows rows={[splitRow('Creators', r.split.creators), splitRow('Holders', r.split.holders), splitRow('Protocol', r.split.platform), splitRow('Meteora', r.split.meteora)]} empty="no coin has migrated in this period" />
          <p className="muted xs an-note">counted when a coin migrates. protocol is before network costs.</p>
          {d.waiting && <div className="an-stats tight an-after">
            <Stat label="Fees waiting on curves" value={usd(d.waiting.sol)} sub={solText(d.waiting.sol)} />
            <Stat label="Of which creators" value={usd(d.waiting.creators)} sub={solText(d.waiting.creators)} />
          </div>}
          {d.waiting && d.waiting.of > d.waiting.read && <p className="muted xs an-note">the newest {d.waiting.read} of {count(d.waiting.of)} coins on a curve.</p>}
        </section>
        <section className="panel">
          <h2 className="an-h">Holders at migration</h2>
          <div className="an-stats tight">
            <Stat label="Wallets paid" value={count(d.holders.paid)} />
            <Stat label="Coins received" value={pct(d.holders.keptPct)} sub="of what they held" />
            <Stat label="Lowest on one coin" value={pct(d.holders.keptLowest)} />
          </div>
          <h2 className="an-h an-after-h">Ticker fees</h2>
          <div className="an-stats tight">
            <Stat label="Paid for a used ticker" value={count(d.tickerFees.coins)} />
            <Stat label="Collected" value={usd(d.tickerFees.sol)} sub={solText(d.tickerFees.sol)} />
          </div>
        </section>
      </div>

      <p className="muted xs an-foot">dollar figures use today's SOL price. curve volume comes from each coin's on-chain history once it migrates, and from trades placed on this site while it is on a curve. updated {ago(d.at)}.{d.official && <> <a className="green" href={pumpLink(d.official.mint)} target="_blank" rel="noreferrer">${d.official.symbol} on Pumpfun</a>.</>}</p>
    </main>
  );
}
