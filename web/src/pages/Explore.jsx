import { useEffect, useMemo, useState } from 'react';
import { Link } from '../lib/router.js';
import { api } from '../lib/api.js';
import CoinCard from '../components/CoinCard.jsx';

const PAGE = 24;
const progressOf = (c) => c.window?.progress ?? 0;
const onPumpfun = (c) => (c.kind === 'window' ? c.window?.phase === 'graduated' : true);
const onCurve = (c) => c.kind === 'window' && ['opening', 'trading'].includes(c.window?.phase);
const NEAR = 0.7; // "about to migrate": at least this far along its curve

const TABS = [
  { id: 'all', t: 'All', test: () => true },
  { id: 'curve', t: 'On curve', test: onCurve },
  { id: 'near', t: 'About to migrate', test: (c) => onCurve(c) && progressOf(c) >= NEAR },
  { id: 'pumpfun', t: 'On Pumpfun', test: onPumpfun },
];
const SORTS = [
  { id: 'new', t: 'Newest', by: (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) },
  { id: 'active', t: 'Last trade', by: (a, b) => (b.bumpedAt ?? 0) - (a.bumpedAt ?? 0) },
  { id: 'cap', t: 'Market cap', by: (a, b) => (b.capUsd ?? 0) - (a.capUsd ?? 0) },
  { id: 'progress', t: 'Curve progress', by: (a, b) => progressOf(b) - progressOf(a) },
];

/** Every coin on the site. The list comes whole from /api/coins; tabs, sort and paging happen here, so they answer at once. */
export default function Explore() {
  const [coins, setCoins] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState('all');
  const [sort, setSort] = useState('new');
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    let alive = true;
    const load = () => api.coins('created', 'desc', '').then((d) => { if (alive) { setCoins(d.coins); setError(null); } }).catch((e) => { if (alive) setError(e.message); });
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 15_000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  useEffect(() => { setShown(PAGE); }, [q, tab, sort]);

  const needle = q.trim().toLowerCase();
  const list = useMemo(() => {
    const t = TABS.find((x) => x.id === tab), s = SORTS.find((x) => x.id === sort);
    return (coins || [])
      .filter(t.test)
      .filter((c) => !needle || c.name?.toLowerCase().includes(needle) || c.symbol?.toLowerCase().includes(needle) || c.mint.toLowerCase() === needle)
      .sort(s.by);
  }, [coins, tab, sort, needle]);

  return (
    <main className="wrap">
      <div className="explore-head">
        <h1>Explore</h1>
        <p className="muted">{coins ? `${coins.length} coin${coins.length === 1 ? '' : 's'} launched on IPO` : 'Loading coins'}</p>
      </div>
      <div className="explore-bar">
        <input className="explore-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, ticker or address" aria-label="Search coins" />
        <label className="explore-sort">Sort
          <select value={sort} onChange={(e) => setSort(e.target.value)}>{SORTS.map((s) => <option key={s.id} value={s.id}>{s.t}</option>)}</select>
        </label>
      </div>
      <div className="explore-tabs" role="tablist">
        {TABS.map((t) => <button key={t.id} type="button" role="tab" aria-selected={t.id === tab} className={t.id === tab ? 'on' : ''} onClick={() => setTab(t.id)}>{t.t}</button>)}
      </div>
      {error && <div className="err">{error}</div>}
      {coins && list.length === 0 && (
        <div className="empty">
          {needle ? `Nothing matches "${q.trim()}".` : tab === 'all' ? <>No coins have launched here yet. <Link href="/create" className="green">Launch the first one</Link></> : 'No coins here right now.'}
        </div>
      )}
      <div className="grid">{list.slice(0, shown).map((c) => <CoinCard key={c.mint} c={c} />)}</div>
      {list.length > shown && <div className="explore-more"><button type="button" className="btn ghost" onClick={() => setShown((n) => n + PAGE)}>Show more</button></div>}
    </main>
  );
}
