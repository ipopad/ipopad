import { useEffect, useRef, useState } from 'react';
import { Link } from '../lib/router.js';
import { api } from '../lib/api.js';
import CoinCard from '../components/CoinCard.jsx';
import { Crown } from '../components/Chrome.jsx';
import { ago, usdK } from '../lib/format.js';

export default function Board({ cfg = {} }) {
  const [copied, setCopied] = useState(false);
  const official = cfg.official;
  const [data, setData] = useState(null);
  const sort = 'created', order = 'desc'; // the full list, with its filters, is on /explore
  const anim = true;
  const query = '';
  const [error, setError] = useState(null);
  const bumped = useRef(new Map());
  const [flash, setFlash] = useState(new Set());

  useEffect(() => {
    let alive = true;
    const load = () => api.coins(sort, order, query).then((d) => {
      if (!alive) return;
      // A coin whose bump time moved since the last read flashes (the old site's "bump" animation).
      const f = new Set();
      for (const c of d.coins) { const prev = bumped.current.get(c.mint); if (prev && prev !== c.bumpedAt) f.add(c.mint); bumped.current.set(c.mint, c.bumpedAt); }
      setFlash(f);
      setData(d);
      setError(null);
    }).catch((e) => { if (alive) setError(e.message); });
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 10_000);
    return () => { alive = false; clearInterval(id); };
  }, [sort, order, query]);

  return (
    <main className="wrap">
      <section className="hero">
        <img className="hero-mark" src="/icon-512.png" alt="" width="176" height="176" />
        <h1 className="grad">IPO</h1>
        <p className="hero-sub">Initial Pump Offering</p>
        <div className="row">
          <Link href="/create" className="btn light big">Launch</Link>
          <Link href="/how" className="btn ghost big">How it works</Link>
        </div>
        {official && (
          <div className="ca"><b>CA:</b><Link href={`/coin/${official.mint}`} className="ca-addr">{official.mint}</Link>
            <button className="copy" onClick={() => { navigator.clipboard?.writeText(official.mint).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}>{copied ? 'copied' : 'copy'}</button></div>
        )}
      </section>
      {data?.king && (
        <>
          <div className="section-title"><div className="koth-title"><Crown /><h2>King of the hill</h2><Crown /></div></div>
          <div className="koth"><div><CoinCard c={data.king} className="row-card" flash={anim && flash.has(data.king.mint)} />
            <div className="muted xs" style={{ textAlign: 'center' }}>{data.king.crowned ? `crowned ${ago(data.king.crownedAt)} at ${usdK(data.king.capUsd)} mcap` : `leading at ${usdK(data.king.capUsd)} mcap; the crown is taken at ${usdK(data.kothUsd)}`}</div></div></div>
        </>
      )}
      <div style={{ height: 56 }} />
      {error && <div className="err">{error}</div>}
      {data && data.coins.length === 0 && (
        <div className="empty">no coins have been launched here yet. <Link href="/create" className="green">[launch coin]</Link></div>
      )}
      {data && data.coins.length > 0 && <div className="section-title explore-link"><h2>Latest coins</h2><Link href="/explore" className="btn ghost">Explore all</Link></div>}
      <div className="grid">
        {(data?.coins || []).slice(0, 8).map((c) => <CoinCard key={c.mint} c={c} flash={anim && flash.has(c.mint)} />)}
      </div>
    </main>
  );
}
