import { useEffect, useRef, useState } from 'react';
import { Link } from '../lib/router.js';
import { api } from '../lib/api.js';
import CoinCard from '../components/CoinCard.jsx';
import { Wordmark } from '../components/Shell.jsx';
import { Icon } from '../components/Icons.jsx';
import { usdK, count } from '../lib/format.js';

const Head = ({ kicker, plain, strong }) => (
  <div className="pf-head"><div className="pf-kicker">{kicker}</div><h2>{plain} <b>{strong}</b></h2><i className="pf-rule" /></div>
);
const FEATURES = [
  ['zap', 'Anti-Snipe Tax', 'About 99% in the first second, gone after three. Bots pay for it. People never have to.'],
  ['flag', 'Fair From Block One', '3% max per wallet and a 3% trade guard on every coin. The token enforces it, not the website.'],
  ['layers', 'Automatic Migration', 'Pick your market cap. When the curve fills, your coin moves to Pumpfun by itself.'],
  ['users', 'Nothing to Claim', 'Every holder gets the new coin sent to their wallet. No claim, no transaction to sign.'],
  ['gift', 'Your Rewards, Your Call', 'Creator fees go to you or to your holders. Set at launch, collect any time on the curve.'],
  ['at', 'Every CA Ends in ipo', 'On the curve and on Pumpfun. Same 1.25% fee as Pumpfun, on every SOL pair trade.'],
];
const STEPS = [
  ['rocket', 'Launch', 'Name, ticker, image, market cap. Add anti-bundle or trade only if you want. Done in one transaction.'],
  ['trend', 'Trade', 'A curve shaped like Pumpfun\'s, with the rules checked by the token on every trade and every send.'],
  ['layers', 'Migrate', 'The curve fills and a new Pumpfun coin is born. Holders usually receive 97% to 99% of what they held.'],
];

export default function Board({ cfg = {} }) {
  const [copied, setCopied] = useState(false);
  const official = cfg.official;
  const [data, setData] = useState(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const bumped = useRef(new Map());
  const [flash, setFlash] = useState(new Set());

  useEffect(() => {
    let alive = true;
    const load = () => {
      api.stats().then((s) => { if (alive) setStats(s); }).catch(() => {});
      return api.coins('created', 'desc', '').then((d) => {
        if (!alive) return;
        // A coin whose bump time moved since the last read flashes.
        const f = new Set();
        for (const c of d.coins) { const prev = bumped.current.get(c.mint); if (prev && prev !== c.bumpedAt) f.add(c.mint); bumped.current.set(c.mint, c.bumpedAt); }
        setFlash(f);
        setData(d);
        setError(null);
      }).catch((e) => { if (alive && !e.network) setError(e.message); }); // no connection: keep the page, the next pass retries
    };
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 10_000);
    // $IPO landed: the server's board is cached for 5 s, so read once more just after that
    const again = official?.mint ? setTimeout(load, 5_500) : null;
    return () => { alive = false; clearInterval(id); clearTimeout(again); };
  }, [official?.mint]);

  const STATS = [
    ['coins', stats ? count(stats.coins) : '–', 'Total Coins'],
    ['chart', stats ? usdK(stats.marketCapUsd) : '–', 'Market Cap'],
    ['layers', stats ? count(stats.onPumpfun) : '–', 'On Pumpfun'],
    ['users', stats ? count(stats.traders) : '–', 'Traders'],
  ];

  return (
    <main className="pf-page pf-home">
      <section className="pf-hero">
        <div className="pf-hero-mark"><img src="/icon-512.png" alt="" width="200" height="200" /></div>
        <h1><Wordmark /></h1>
        <p className="pf-lede">A better way to launch on Pumpfun</p>
        <div className="pf-hero-cta">
          <Link href="/launch" className="pf-btn primary big">LAUNCH</Link>
          <Link href="/explore" className="pf-btn quiet big">EXPLORE</Link>
        </div>
        {official && (
          <div className="pf-ca"><b>CA</b><Link href={`/coin/${official.mint}`}>{official.mint}</Link>
            <button onClick={() => { navigator.clipboard?.writeText(official.mint).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}><Icon n="copy" s={14} />{copied ? 'Copied' : 'Copy'}</button></div>
        )}
      </section>

      <section className="pf-sec reveal">
        <Head kicker="LIVE DATA" plain="Platform" strong="Statistics" />
        <div className="pf-stats">
          {STATS.map(([icon, value, label]) => (
            <div key={label} className="pf-stat"><span className="pf-stat-i"><Icon n={icon} s={20} /></span><b>{value}</b><span>{label}</span></div>
          ))}
        </div>
      </section>

      <section className="pf-sec reveal">
        <Head kicker="WHY CHOOSE US" plain="Designed for" strong="Fair Launches" />
        <div className="pf-cards">
          {FEATURES.map(([icon, title, text]) => (
            <div key={title} className="pf-card"><span className="pf-card-i"><Icon n={icon} s={24} /></span><h3>{title}</h3><p>{text}</p></div>
          ))}
        </div>
      </section>

      <section className="pf-sec reveal">
        <Head kicker="THE FULL CYCLE" plain="From Curve to" strong="Pumpfun" />
        <div className="pf-cards steps">
          {STEPS.map(([icon, title, text], i) => (
            <div key={title} className="pf-card"><span className="pf-step-n">{i + 1}</span><span className="pf-card-i"><Icon n={icon} s={24} /></span><h3>{title}</h3><p>{text}</p></div>
          ))}
        </div>
        <div className="pf-sec-cta"><Link href="/docs/how-it-works" className="pf-btn outline">Discover More<Icon n="right" s={16} /></Link></div>
      </section>

      <section className="pf-sec reveal">
        <Head kicker="LIVE COINS" plain="Latest" strong="Coins" />
        {error && <div className="err">{error}</div>}
        {data && data.coins.length === 0 && <div className="pf-none">No coins yet. <Link href="/launch">Launch the first one</Link></div>}
        <div className="grid">{(data?.coins || []).slice(0, 8).map((c) => <CoinCard key={c.mint} c={c} flash={flash.has(c.mint)} />)}</div>
        {data && data.coins.length > 0 && <div className="pf-sec-cta"><Link href="/explore" className="pf-btn outline">Explore All<Icon n="right" s={16} /></Link></div>}
      </section>
    </main>
  );
}
