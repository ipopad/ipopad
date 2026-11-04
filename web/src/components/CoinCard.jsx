import { Link } from '../lib/router.js';
import { usdK, ago, shortName, colorOf } from '../lib/format.js';

/** Where a coin is, in the board's words: its window phase, or On Pumpfun. */
export function phaseOf(c) {
  if (c.kind === 'window') {
    const w = c.window;
    if (w?.phase === 'graduated') return { t: 'On Pumpfun', cls: 'green' };
    if (w?.phase === 'opening') return { t: 'opens soon', cls: 'yellow' };
    if (w?.phase === 'trading') return w.closesAt ? { t: `window ${ago(w.closesAt * 1000).replace(' ago', '')}`, cls: 'yellow' } : { t: `${Math.round((w.progress ?? 0) * 100)}% to Pumpfun`, cls: '' };
    return { t: 'migrating', cls: 'yellow' };
  }
  return { t: 'On Pumpfun', cls: 'green' }; // a plain pump.fun coin, $IPO: on Pumpfun from its first second
}

/** The pair a coin is launched against, unless it is SOL or the pair fell back to SOL. */
export const pairOf = (c) => (c.window?.pair && c.window.pair.state !== 'fallback' ? c.window.pair : null);
export const PairTag = ({ pair }) => <span className="pf-pair">{pair.icon && <img src={pair.icon} alt="" />}Paired with {pair.symbol}</span>;

export default function CoinCard({ c, flash = false, className = '' }) {
  const phase = phaseOf(c);
  const curve = c.kind === 'window' && c.window?.phase === 'trading' && !c.window.closesAt ? Math.round((c.window.progress ?? 0) * 100) : null;
  return (
    <Link href={`/coin/${c.mint}`} className={`card${flash ? ' flash' : ''} ${className}`}>
      <div className="media">
        <img src={c.image} alt="" loading="lazy" />
        {c.origin === 'official' && <span className="chip l green">official</span>}
        {phase && curve == null && <span className={`chip r ${phase.cls}`}>{phase.t}</span>}
      </div>
      <div className="body">
        <div className="sym"><span>${c.symbol}</span>{pairOf(c) && <PairTag pair={pairOf(c)} />}</div>
        <div className="name">{c.name} ({c.symbol})</div>
        <div className="cap"><b>{usdK(c.capUsd)}</b><span>market cap</span></div>
        <div className="meta">created by <i className="avatar" style={{ background: colorOf(c.creator) }} /><span className="blue">{shortName(c.creator)}</span>{ago(c.createdAt)}</div>
        {curve != null && <div className="prog"><div className="row"><span>to Pumpfun</span><span>{curve}%</span></div><div className="bar"><i style={{ width: `${curve}%` }} /></div></div>}
      </div>
    </Link>
  );
}
