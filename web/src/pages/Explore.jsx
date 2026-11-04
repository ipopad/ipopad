import { useEffect, useMemo, useState } from 'react';
import { Link } from '../lib/router.js';
import { api } from '../lib/api.js';
import CoinCard, { phaseOf, pairOf, PairTag } from '../components/CoinCard.jsx';
import { Icon } from '../components/Icons.jsx';
import { usdK, ago, shortName, colorOf } from '../lib/format.js';

const PAGE = 24;
const NEAR = 0.7; // "about to migrate": at least this far along its curve
const progressOf = (c) => c.window?.progress ?? 0;
const onPumpfun = (c) => (c.kind === 'window' ? c.window?.phase === 'graduated' : true);
const onCurve = (c) => c.kind === 'window' && ['opening', 'trading'].includes(c.window?.phase);
const migrating = (c) => c.kind === 'window' && ['closing', 'graduating'].includes(c.window?.phase);
const near = (c) => migrating(c) || (onCurve(c) && progressOf(c) >= NEAR);

const TABS = [
  { id: 'all', t: 'All', test: () => true },
  { id: 'curve', t: 'On curve', test: onCurve },
  { id: 'near', t: 'About to migrate', test: near },
  { id: 'pumpfun', t: 'On Pumpfun', test: onPumpfun },
];
const SORTS = [
  { id: 'new', t: 'Newest', by: (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) },
  { id: 'active', t: 'Last trade', by: (a, b) => (b.bumpedAt ?? 0) - (a.bumpedAt ?? 0) },
  { id: 'cap', t: 'Market cap', by: (a, b) => (b.capUsd ?? 0) - (a.capUsd ?? 0) },
  { id: 'progress', t: 'Curve progress', by: (a, b) => progressOf(b) - progressOf(a) },
];
const COLUMNS = [
  { id: 'new', t: 'New Coins', icon: 'zap', test: (c) => onCurve(c) && progressOf(c) < NEAR, by: SORTS[0].by },
  { id: 'near', t: 'About to Migrate', icon: 'rocket', test: near, by: SORTS[3].by },
  { id: 'pump', t: 'On Pumpfun', icon: 'layers', test: onPumpfun, by: SORTS[2].by },
];
const VIEWS = [['terminal', 'columns', 'Terminal'], ['cards', 'grid', 'Cards'], ['table', 'list', 'Table']];
const matches = (c, needle) => !needle || c.name?.toLowerCase().includes(needle) || c.symbol?.toLowerCase().includes(needle) || c.mint.toLowerCase() === needle;
const readView = () => { try { return localStorage.getItem('ipo-explore') || 'terminal'; } catch { return 'terminal'; } };

function Row({ c }) {
  const inCurve = onCurve(c);
  return (
    <Link href={`/coin/${c.mint}`} className="pf-row">
      <img src={c.image} alt="" loading="lazy" />
      <span className="pf-row-t">
        <span className="pf-row-top"><b>${c.symbol}</b><span>{ago(c.createdAt)}</span></span>
        <span className="pf-row-name">{c.name}</span>
        {pairOf(c) && <PairTag pair={pairOf(c)} />}
        {inCurve && <span className="pf-row-bar"><i style={{ width: `${Math.round(progressOf(c) * 100)}%` }} /></span>}
      </span>
      <span className="pf-row-cap"><b>{usdK(c.capUsd)}</b>{c.origin === 'official' ? <em>official</em> : inCurve ? <small>{Math.round(progressOf(c) * 100)}%</small> : null}</span>
    </Link>
  );
}

function Column({ col, coins }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => coins.filter(col.test).filter((c) => matches(c, q.trim().toLowerCase())).sort(col.by), [coins, col, q]);
  return (
    <section className={`pf-col ${col.id}`}>
      <header><Icon n={col.icon} /><h2>{col.t}</h2><span>{list.length}</span></header>
      <label className="pf-search"><Icon n="search" s={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search..." aria-label={`Search ${col.t}`} /></label>
      <div className="pf-col-list">
        {list.length === 0 ? <div className="pf-col-none">No coins in this category</div> : list.map((c) => <Row key={c.mint} c={c} />)}
      </div>
    </section>
  );
}

function Table({ list }) {
  return (
    <div className="pf-table-wrap">
      <table className="pf-table">
        <thead><tr><th>Coin</th><th>Pair</th><th className="pf-num">Market cap</th><th>Status</th><th>Created</th><th>Creator</th></tr></thead>
        <tbody>
          {list.map((c) => {
            const phase = phaseOf(c);
            return (
              <tr key={c.mint}>
                <td><Link href={`/coin/${c.mint}`} className="pf-cell-coin"><img src={c.image} alt="" loading="lazy" /><span><b>${c.symbol}</b><small>{c.name}</small></span></Link></td>
                <td>{pairOf(c) ? <PairTag pair={pairOf(c)} /> : <span className="muted">SOL</span>}</td>
                <td className="pf-num hi">{usdK(c.capUsd)}</td>
                <td><span className={`pf-tag${phase.cls === 'green' ? ' on' : ''}`}>{phase.t}</span></td>
                <td className="muted">{ago(c.createdAt)}</td>
                <td><i className="avatar" style={{ background: colorOf(c.creator) }} /> <span className="muted">{shortName(c.creator)}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Every coin on the site. The list comes whole from /api/coins; views, tabs, sort and paging happen here, so they answer at once. */
export default function Explore() {
  const [coins, setCoins] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState('all');
  const [sort, setSort] = useState('new');
  const [shown, setShown] = useState(PAGE);
  const [view, setViewState] = useState(readView);
  const [spin, setSpin] = useState(false);
  const setView = (v) => { setViewState(v); try { localStorage.setItem('ipo-explore', v); } catch {} };

  const load = () => api.coins('created', 'desc', '').then((d) => { setCoins(d.coins); setError(null); }).catch((e) => { if (!e.network) setError(e.message); });
  useEffect(() => {
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 15_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => { setShown(PAGE); }, [q, tab, sort]);

  const needle = q.trim().toLowerCase();
  const list = useMemo(() => {
    const t = TABS.find((x) => x.id === tab), s = SORTS.find((x) => x.id === sort);
    return (coins || []).filter(t.test).filter((c) => matches(c, needle)).sort(s.by);
  }, [coins, tab, sort, needle]);
  const refresh = () => { setSpin(true); load().finally(() => setTimeout(() => setSpin(false), 500)); };

  return (
    <main className="pf-page pf-explore">
      <div className="pf-explore-bar">
        <div className="pf-explore-tools">
          <button className={`pf-btn quiet small${spin ? ' spinning' : ''}`} onClick={refresh}><Icon n="refresh" s={15} />Refresh</button>
          <div className="pf-seg" role="tablist">{VIEWS.map(([id, icon, t]) => <button key={id} role="tab" aria-selected={view === id} className={view === id ? 'on' : ''} onClick={() => setView(id)}><Icon n={icon} s={15} />{t}</button>)}</div>
        </div>
      </div>
      {error && <div className="err">{error}</div>}
      {view === 'terminal' ? (
        <div className="pf-columns">{COLUMNS.map((c) => <Column key={c.id} col={c} coins={coins || []} />)}</div>
      ) : (
        <>
          <div className="pf-filter">
            <label className="pf-search"><Icon n="search" s={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, ticker or address" aria-label="Search coins" /></label>
            <label className="pf-sort">Sort<select value={sort} onChange={(e) => setSort(e.target.value)}>{SORTS.map((s) => <option key={s.id} value={s.id}>{s.t}</option>)}</select></label>
          </div>
          <div className="pf-tabs" role="tablist">{TABS.map((t) => <button key={t.id} type="button" role="tab" aria-selected={t.id === tab} className={t.id === tab ? 'on' : ''} onClick={() => setTab(t.id)}>{t.t}</button>)}</div>
          {coins && list.length === 0 && <div className="pf-none">{needle ? `Nothing matches "${q.trim()}".` : tab === 'all' ? <>No coins yet. <Link href="/launch">Launch the first one</Link></> : 'No coins in this category'}</div>}
          {view === 'cards' ? <div className="grid">{list.slice(0, shown).map((c) => <CoinCard key={c.mint} c={c} />)}</div> : list.length > 0 && <Table list={list.slice(0, shown)} />}
          {list.length > shown && <div className="pf-sec-cta"><button type="button" className="pf-btn outline" onClick={() => setShown((n) => n + PAGE)}>Show more</button></div>}
        </>
      )}
    </main>
  );
}
