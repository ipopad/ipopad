import { useEffect, useState } from 'react';
import { Link } from '../lib/router.js';
import { api } from '../lib/api.js';
import { useWallet } from '../lib/wallet.jsx';
import { short, usdK, count } from '../lib/format.js';
import { XIcon, GhIcon, SOCIAL_X, SOCIAL_GH } from './Chrome.jsx';
import { Icon } from './Icons.jsx';

const NAV = [
  { title: 'Navigation', items: [['/', 'home', 'Home'], ['/explore', 'trend', 'Explore'], ['/analytics', 'chart', 'Analytics'], ['/docs', 'book', 'Docs']] },
  { title: 'Tools', items: [['/launch', 'rocket', 'Launch']] },
];
export const Wordmark = ({ className = '' }) => <span className={`pf-word ${className}`}>IPO</span>;

function Sidebar({ path, open, close }) {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => api.stats().then((s) => { if (alive) setStats(s); }).catch(() => {});
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return (
    <aside className={`pf-side${open ? ' open' : ''}`}>
      <Link href="/" className="pf-brand" onClick={close}><img src="/icon-48.png" alt="" width="32" height="32" /><Wordmark /></Link>
      <nav className="pf-nav">
        {NAV.map((g) => (
          <div key={g.title} className="pf-nav-group">
            <div className="pf-nav-title">{g.title}</div>
            {g.items.map(([href, icon, label]) => {
              const on = href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`);
              return <Link key={href} href={href} className={on ? 'on' : ''} onClick={close}><Icon n={icon} />{label}</Link>;
            })}
          </div>
        ))}
      </nav>
      <div className="pf-side-end">
        <div className="pf-side-card"><span>Coins launched</span><b>{stats ? count(stats.coins) : '–'}</b></div>
        <div className="pf-side-links">
          <a href={SOCIAL_X} target="_blank" rel="noreferrer" aria-label="X"><XIcon /></a>
          <a href={SOCIAL_GH} target="_blank" rel="noreferrer" aria-label="GitHub"><GhIcon /></a>
        </div>
      </div>
    </aside>
  );
}

/** The ten biggest coins, rolling. Doubled so the loop has no seam; it only moves when there is more than fits. */
function Trending() {
  const [coins, setCoins] = useState([]);
  useEffect(() => {
    let alive = true;
    const load = () => api.coins('cap', 'desc', '').then((d) => { if (alive) setCoins([...d.coins].filter((c) => c.capUsd != null).sort((a, b) => b.capUsd - a.capUsd).slice(0, 10)); }).catch(() => {});
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 20_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const item = (c, i, copy) => (
    <Link key={`${copy}${c.mint}`} href={`/coin/${c.mint}`} className={`pf-trend-item${i < 3 ? ' top' : ''}`} tabIndex={copy ? -1 : undefined} aria-hidden={copy ? 'true' : undefined}>
      <span className="pf-trend-n">#{i + 1}</span>
      {c.image && <img src={c.image} alt="" />}
      <span className="pf-trend-t"><b>${c.symbol}</b><small>{usdK(c.capUsd)}</small></span>
    </Link>
  );
  return (
    <div className="pf-trend">
      <div className="pf-trend-view">
        {coins.length > 0 && <div className="pf-trend-track" style={{ animationDuration: `${Math.max(20, coins.length * 6)}s` }}>
          {coins.map((c, i) => item(c, i, ''))}
          {coins.map((c, i) => item(c, i, 'copy-'))}
        </div>}
      </div>
    </div>
  );
}

const readFolded = () => { try { return localStorage.getItem('ipo-side') === 'folded'; } catch { return false; } };

export default function Shell({ path, children }) {
  const w = useWallet();
  const [folded, setFolded] = useState(readFolded);
  const [drawer, setDrawer] = useState(false);
  const toggle = () => {
    if (matchMedia('(max-width: 900px)').matches) { setDrawer((d) => !d); return; }
    setFolded((f) => { try { localStorage.setItem('ipo-side', f ? 'open' : 'folded'); } catch {} return !f; });
  };
  return (
    <div className={`pf-app${folded ? ' folded' : ''}`}>
      <Sidebar path={path} open={drawer} close={() => setDrawer(false)} />
      {drawer && <button className="pf-scrim" aria-label="Close menu" onClick={() => setDrawer(false)} />}
      <div className="pf-main">
        <header className="pf-top">
          <button className="pf-toggle" aria-label="Toggle sidebar" onClick={toggle}><Icon n="panel" /></button>
          <Link href="/" className="pf-top-mark" aria-label="Home"><img src="/icon-48.png" alt="" width="28" height="28" /></Link>
          <Trending />
          <div className="pf-top-end">
            <Link href="/launch" className="pf-btn primary pf-top-launch"><Icon n="plus" s={16} />Launch coin</Link>
            {w.address
              ? <span className="wallet-pill"><i className="dot" />{short(w.address)}<button className="x" onClick={w.disconnect}>Disconnect</button></span>
              : <button className="pf-btn primary" onClick={() => w.connect().catch(() => {})}><Icon n="wallet" s={16} />Connect wallet</button>}
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
