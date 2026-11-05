import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { Modal } from './Chrome.jsx';

const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const money = (n) => (!n ? '' : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${n}`);
const SolIcon = () => <span className="pair-icon pair-sol" />;
/** A logo that fades in when it has loaded, and a letter badge when there is none or it fails. */
function Icon({ src, big, label }) {
  const [state, setState] = useState('loading');
  useEffect(() => { setState('loading'); }, [src]);
  const cls = `pair-icon${big ? ' big' : ''}`;
  if (!src || state === 'failed') return <span className={`${cls} pair-letter`} aria-hidden="true">{String(label || '?').replace(/^\$/, '').slice(0, 1).toUpperCase()}</span>;
  return <span className={cls}><img className={state === 'ready' ? 'ready' : ''} src={src} alt="" loading="lazy" decoding="async" onLoad={() => setState('ready')} onError={() => setState('failed')} /></span>;
}
const Candles = () => <svg className="pair-icon pair-candles" viewBox="0 0 22 22" aria-hidden="true"><path d="M7 3v3M7 15v4M15 2v5M15 15v4" stroke="currentColor" strokeWidth="1.6" /><rect x="4.5" y="6" width="5" height="9" rx="1" fill="currentColor" /><rect x="12.5" y="7" width="5" height="8" rx="1" fill="currentColor" /></svg>;
const Check = () => <svg className="pair-check" viewBox="0 0 16 16" aria-label="verified"><circle cx="8" cy="8" r="7" fill="currentColor" /><path d="M4.8 8.2l2.2 2.2 4.2-4.6" fill="none" stroke="#0b0b0e" strokeWidth="1.7" /></svg>;
const TABS = [['all', 'All'], ['stocks', 'Stocks'], ['crypto', 'Crypto'], ['memes', 'Memes']];

// outside the picker: defined inside it, every keystroke remounted each row and reloaded its logo
const Row = ({ p, onPick }) => (
  <button type="button" className="pair-row" onClick={() => onPick(p)}>
    <Icon src={p.icon} big label={p.symbol} />
    <span className="pair-who"><span className="b">{p.name || p.symbol}{p.verified && <Check />}</span><span className="muted xs">{p.symbol}</span></span>
    <span className="pair-nums">{p.mcap > 0 && <span className="b">{money(p.mcap)}</span>}<span className="muted xs">Liquidity · {money(p.liquidity)}</span></span>
  </button>
);

/**
 * The pair section, laid out like Pumpfun's create page: SOL, USDC or Custom. Custom opens a searchable list with category tabs, and a
 * pasted address is checked against Pumpfun's custom-pair list. `onIncomplete(true)` while Custom is picked with no token yet.
 */
export default function PairPicker({ value, onChange, onIncomplete, disabled }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [list, setList] = useState([]);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState('all');
  const [found, setFound] = useState(null); // { ok, pair, why } for a pasted address
  const [checking, setChecking] = useState(false);

  // custom pairs can be missing for a moment (USDC never is): keep asking until they arrive
  useEffect(() => {
    let alive = true, t = null;
    const load = () => api.pairs().then((d) => { if (alive) setList(d.pairs || []); return (d.pairs || []).length; }).catch(() => 0).then((n) => { if (alive && n < 2) t = setTimeout(load, 8_000); });
    load();
    return () => { alive = false; clearTimeout(t); };
  }, []);
  const usdc = list.find((p) => p.kind === 'usdc');
  const mode = custom ? 'custom' : value?.kind === 'usdc' ? 'usdc' : 'sol';
  useEffect(() => { onIncomplete?.(custom && !value); }, [custom, value]);
  const query = q.trim();
  const isCa = B58.test(query);
  useEffect(() => {
    setFound(null);
    setChecking(false);
    if (!isCa) return undefined;
    const inList = list.find((p) => p.mint === query);
    if (inList) { setFound({ ok: true, pair: inList }); return undefined; }
    let alive = true;
    setChecking(true);
    api.pair(query).then((r) => { if (alive) setFound(r); }).catch((e) => { if (alive) setFound({ ok: false, why: e.message }); }).finally(() => { if (alive) setChecking(false); });
    return () => { alive = false; setChecking(false); };
  }, [query, isCa, list]);

  const shown = useMemo(() => {
    if (isCa) return [];
    const n = query.toLowerCase();
    return list.filter((p) => p.kind !== 'usdc' && (tab === 'all' || p.category === tab) && (!n || p.symbol.toLowerCase().includes(n) || p.name.toLowerCase().includes(n)));
  }, [list, query, isCa, tab]);

  const close = () => { setOpen(false); setQ(''); setFound(null); };
  const pick = (p) => { onChange(p); close(); };

  return (
    <>
      <div className="pair-tabs" role="radiogroup" aria-label="Pool liquidity pair">
        <button type="button" role="radio" aria-checked={mode === 'sol'} className={mode === 'sol' ? 'on' : ''} disabled={disabled} onClick={() => { setCustom(false); onChange(null); }}><SolIcon />SOL</button>
        <button type="button" role="radio" aria-checked={mode === 'usdc'} className={mode === 'usdc' ? 'on' : ''} disabled={disabled || !usdc} onClick={() => { setCustom(false); onChange(usdc); }}><Icon src={usdc?.icon} label="USDC" />USDC</button>
        <button type="button" role="radio" aria-checked={mode === 'custom'} className={mode === 'custom' ? 'on' : ''} disabled={disabled} onClick={() => { setCustom(true); onChange(null); }}><Candles />Custom</button>
      </div>
      {mode === 'custom' && (
        <button type="button" className="pair-button" disabled={disabled} onClick={() => setOpen(true)}>
          {value ? <><Icon src={value.icon} label={value.symbol} /><span className="b">Pair with {value.name || value.symbol} ({value.symbol})</span><span className="muted pair-go">Change ›</span></> : <><span className="b">Select custom pair</span><span className="muted pair-go">›</span></>}
        </button>
      )}
      {open && (
        <Modal onClose={close} wide>
          <h2 className="pair-title">Select custom pair</h2>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search for a custom pair" />
          {!isCa && <div className="pair-cats">{TABS.map(([id, t]) => <button key={id} type="button" className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{t}</button>)}</div>}
          {isCa && (
            <div>
              {checking && <div className="muted sm">Checking the token…</div>}
              {found?.ok && <Row p={found.pair} onPick={pick} />}
              {found && !found.ok && <div className="err">{found.why}</div>}
            </div>
          )}
          {!isCa && (
            <div className="pair-list">
              {shown.map((p) => <Row key={p.mint} p={p} onPick={pick} />)}
              {!shown.length && <div className="muted sm" style={{ textAlign: 'center' }}>{list.length ? `No pair matches${query ? ` "${query}"` : ' here'}. Paste its address to check it.` : 'Loading pairs…'}</div>}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
