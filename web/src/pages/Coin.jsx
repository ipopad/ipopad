import { useCallback, useEffect, useState } from 'react';
import { Link } from '../lib/router.js';
import { api } from '../lib/api.js';
import { useWallet, cancelled } from '../lib/wallet.jsx';
import Chart from '../components/Chart.jsx';
import { pairOf, PairTag } from '../components/CoinCard.jsx';
import { Modal, Spinner, XIcon } from '../components/Chrome.jsx';
import { Icon } from '../components/Icons.jsx';
import { usdK, ago, short, shortName, colorOf, lamportsToSol, tokens, pumpLink } from '../lib/format.js';
import { RulesLines } from '../components/Rules.jsx';
import { parseWallets } from '../lib/rulesText.js';

import { fillList } from '../lib/lists.js';

const fmtLeft = (secs) => { const s = Math.max(0, Math.floor(secs)); if (s >= 86400) return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`; if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`; if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`; return `${s}s`; };
function useNow(skew = 0) { const [t, setT] = useState(Date.now() / 1000 + skew); useEffect(() => { const id = setInterval(() => setT(Date.now() / 1000 + skew), 1000); return () => clearInterval(id); }, [skew]); return t; }

/** The window token's state: countdowns, the raise, where it is in its graduation, the pump.fun coin once it exists. */
function WindowPanel({ c }) {
  const w = c.window, t = useNow(w.chainNow ? w.chainNow - Date.now() / 1000 : 0); // the chain's clock, which the hook decides on
  const phaseText = w.phase === 'ended' ? 'the window ended with no holders: nothing migrated'
    : w.phase === 'opening' ? `anti-snipe tax is on: normal fees in ${fmtLeft(w.opensAt - t)}`
    : w.phase === 'trading' ? (w.closesAt ? `window ends in ${fmtLeft(w.closesAt - t)}` : null)
    : w.phase === 'closing' ? 'window closed: migrating to Pumpfun now'
    : `migrating to Pumpfun (${w.status})`;
  if (w.phase === 'graduated') return null; // the coin card holds the new address
  const pct = Math.round((w.progress ?? 0) * 100);
  return (
    <div className="panel sm">
      {phaseText && <div className="b yellow">{phaseText}</div>}
      {w.phase !== 'graduated' && w.phase !== 'ended' && <>
        <div style={{ textAlign: 'center' }}>curve progress: {pct}%</div>
        <div className="bar"><i style={{ width: `${pct}%` }} /></div>
      </>}
      {w.pair && w.phase !== 'graduated' && <div className="muted xs">migrates into a Pumpfun coin paired with {w.pair.symbol ?? 'a custom pair'}{w.pair.creatorFeeBps ? `, ${w.pair.creatorFeeBps / 100}% creator fee` : ''}.</div>}
      {w.pair?.state === 'fallback' && <div className="muted xs">the custom pair could not be used at migration, so the coin migrated against SOL.</div>}
      {c.holderRewards && <div className="muted xs">creator rewards go to the holders (pump.fun holder rewards).</div>}
      {w.rules?.any && w.phase !== 'graduated' && w.phase !== 'ended' && <div className="xs" style={{ display: 'grid', gap: 4 }}>
        <div className="muted">rules on its curve, enforced by the hook on every trade and send until it migrates to Pumpfun:</div>
        <RulesLines lines={w.rules.lines} className="xs" />
      </div>}
      {w.list && w.phase !== 'graduated' && w.phase !== 'ended' && <div className="muted xs">{w.rules?.allowlist ? 'allowlist' : 'blocklist'}: {w.list.count} wallet{w.list.count === 1 ? '' : 's'}{w.list.sealed ? ', sealed' : w.list.open ? ', the creator can still add wallets for a day after launch' : ', closed'}.</div>}
    </div>
  );
}

/** The creator's own list panel while the list is open: paste wallets, add them, seal it. */
function ListPanel({ c, onDone }) {
  const w = useWallet();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState(null);
  if (!w.address || w.address !== c.creator) return null;
  const parsed = parseWallets(text);
  const go = async (seal) => {
    setErr(null); setBusy('starting');
    try {
      const { tooLate } = await fillList({ mint: c.mint, wallet: w.address, wallets: parsed.wallets, seal, signTransactions: w.signTransactions, onProgress: setBusy });
      setText(''); if (tooLate.length) setErr(`${tooLate.length} wallet${tooLate.length === 1 ? '' : 's'} could not be added: the list only grows upwards and they sort below its last wallet.`);
      onDone?.();
    } catch (e) { setErr(cancelled(e) ? 'cancelled in your wallet. nothing was sent.' : e.message); }
    setBusy('');
  };
  return (
    <div className="panel sm">
      <div className="b">your {c.window.rules?.allowlist ? 'allowlist' : 'blocklist'}</div>
      <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="wallet addresses, one per line" disabled={Boolean(busy)} />
      {parsed.invalid.length > 0 && <div className="err">not wallet addresses: {parsed.invalid.slice(0, 3).join(', ')}</div>}
      {err && <div className="err">{err}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn small" disabled={Boolean(busy) || !parsed.wallets.length || parsed.invalid.length > 0} onClick={() => go(false)}>{busy ? <><Spinner /> {busy}</> : `add ${parsed.wallets.length || ''} wallets`}</button>
        <button className="btn small ghost" disabled={Boolean(busy) || parsed.invalid.length > 0 || (c.window.rules?.allowlist && (c.window.list?.count ?? 0) + parsed.wallets.length === 0)} onClick={() => go(true)}>{parsed.wallets.length ? 'add and seal' : 'seal the list'}</button>
      </div>
      <div className="muted xs">24 wallets per transaction, one approval per batch. sealing is for good{c.window.rules?.allowlist ? '; an allowlist cannot be sealed empty' : ''}.</div>
    </div>
  );
}


export default function Coin({ mint, cfg }) {
  const [c, setC] = useState(null);
  const [error, setError] = useState(null);
  const [chart, setChart] = useState(null);
  const [interval, setIntervalSecs] = useState(300);
  const load = useCallback(() => {
    api.chart(mint, interval).then((d) => setChart((prev) => (location.pathname.endsWith(mint) ? d : prev))).catch(() => {});
    // a server restart (deploy) answers 502/503 for a few seconds: keep the page and retry on the next poll instead of showing an error
    return api.coin(mint).then((d) => { if (d.mint === mint) { setC(d); setError(null); } }).catch((e) => { if (e.status !== 502 && e.status !== 503 && e.status) setError(e.message); });
  }, [mint, interval]);
  useEffect(() => { setC(null); setChart(null); }, [mint]);
  useEffect(() => {
    setError(null);
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, 10_000);
    return () => clearInterval(id);
  }, [load]);
  // the anti-snipe tax lasts seconds: read again soon so buying opens when it ends, not on the next 10-second pass
  useEffect(() => {
    if (c?.window?.phase !== 'opening') return undefined;
    const id = setTimeout(load, 1000);
    return () => clearTimeout(id);
  }, [c, load]);

  if (error) return <main className="wrap"><div className="narrow"><Link href="/" className="bracket back">[go back]</Link><div className="err">{error}</div></div></main>;
  if (!c) return <main className="wrap"><div className="empty" style={{ marginTop: 40 }}>loading…</div></main>;
  const curveProgress = Math.round((c.progress ?? 0) * 100);
  return (
    <main className="wrap">
      <Link href="/" className="bracket back">[go back]</Link>
      {c.status === 'created' && <div className="ok">your launch was sent and is confirming on chain. this page updates by itself; the coin is tradeable once it shows up on pump.fun.</div>}
      <div className="coinhead">
        <img src={c.image} alt="" />
        <div className="t">
        <h1>{c.name} ({c.symbol})</h1>
        <div className="facts">
        <span className="muted">created by <i className="avatar" style={{ background: colorOf(c.creator) }} /> <span className="blue">{shortName(c.creator)}</span></span>
        <span className="green b">market cap: {usdK(c.capUsd)}</span>
        {pairOf(c) && <PairTag pair={pairOf(c)} />}
        {c.kind !== 'window' && c.holderRewards && <span className="yellow sm">creator rewards to holders</span>}
        {c.kind === 'window' ? (c.window?.pumpMint && <a className="bracket sm" href={pumpLink(c.window.pumpMint)} target="_blank" rel="noreferrer">[view on pump.fun]</a>) : <a className="bracket sm" href={pumpLink(c.mint)} target="_blank" rel="noreferrer">[view on pump.fun]</a>}
        </div>
        </div>
      </div>
      <div className="cols">
        <section>
          <Chart mint={mint} data={chart} solUsd={c.solUsd} interval={interval} setInterval={setIntervalSecs} />
          <div className="coin-trades"><Trades c={c} chart={chart} /></div>
        </section>
        <aside className="side">
          {c.kind === 'window' && c.window && <WindowPanel c={c} />}
          {c.kind === 'window' && c.window?.list?.open && <ListPanel c={c} onDone={load} />}
          <TradePanel c={c} cfg={cfg} onTraded={load} />
          {c.window?.creatorFee && <CreatorFees c={c} onDone={load} />}
          <CoinInfo c={c} cfg={cfg} />
          {c.kind !== 'window' && <div className="panel sm">
            <div>bonding curve progress: {curveProgress}%</div>
            <div className="bar"><i style={{ width: `${curveProgress}%` }} /></div>
            {c.complete && <p className="muted xs" style={{ margin: 0 }}>this coin is On Pumpfun, where it trades now.</p>}
          </div>}
          <div className="panel sm">
            <div className="b">holder distribution</div>
            <div className="holders">
              {c.holders.length === 0 && <div className="muted">reading holders…</div>}
              {c.holders.map((h, i) => (
                <div key={h.account}>
                  <span>{i + 1}. <a className="blue" href={`${cfg.explorer}/account/${h.owner || h.account}`} target="_blank" rel="noreferrer">{shortName(h.owner || h.account)}</a>{h.label ? ` (${h.label})` : h.owner === c.creator ? ' (dev)' : ''}</span>
                  <span>{h.pct.toFixed(2)}%</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

/** The coin's card: who it is, its links and its address, copied in one press. */
function CoinInfo({ c, cfg }) {
  const [copied, setCopied] = useState(false);
  const address = c.window?.pumpMint || c.mint;
  const copy = () => { navigator.clipboard?.writeText(address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); };
  const links = [
    c.socials?.twitter && [c.socials.twitter, <XIcon key="x" />, 'X'],
    c.socials?.telegram && [c.socials.telegram, <Icon key="t" n="send" s={15} />, 'Telegram'],
    c.socials?.website && [c.socials.website, <Icon key="w" n="globe" s={15} />, 'Website'],
  ].filter(Boolean);
  return (
    <div className="panel ci">
      <div className="ci-head">
        <img src={c.image} alt="" />
        <div className="ci-title"><h3>{c.name}</h3><span>${c.symbol}</span></div>
      </div>
      {c.description && <p className="ci-desc">{c.description}</p>}
      {links.length > 0 && <div className="ci-links">{links.map(([href, icon, label]) => <a key={label} href={href} target="_blank" rel="noreferrer">{icon}{label}</a>)}</div>}
      <div className="ci-ca">
        <a href={`${cfg.explorer}/token/${address}`} target="_blank" rel="noreferrer" title={address}><small>CA:</small><span>{short(address, 6)}</span></a>
        <button onClick={copy} aria-label="Copy contract address"><Icon n="copy" s={15} />{copied ? 'Copied' : 'Copy'}</button>
      </div>
    </div>
  );
}

function CreatorFees({ c, onDone }) {
  const w = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);
  const f = c.window.creatorFee;
  if (w.address !== c.creator || !f.trading) return null;
  const owed = Number(f.owed) / 1e9, min = Number(f.min) / 1e9;
  const collect = async () => {
    setBusy(true); setError(null); setMsg(null);
    try {
      const ts = Date.now();
      const signature = await w.signMessage(`ipo creator fee\nmint: ${c.mint}\ntime: ${ts}`);
      const r = await api.collectCreatorFee(c.mint, { wallet: w.address, ts, signature });
      setMsg(`${(Number(r.lamports) / 1e9).toFixed(4)} SOL sent to your wallet.`);
      onDone();
    } catch (e) {
      setError(cancelled(e) ? 'cancelled in your wallet. nothing was sent.' : e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel sm" style={{ textAlign: 'center' }}>
      <div className="b">your creator fees</div>
      <div>{owed.toFixed(4)} SOL ready to collect</div>
      {owed < min && <p className="muted xs" style={{ margin: 0 }}>you can collect from {min} SOL.</p>}
      {error && <div className="err">{error}</div>}
      {msg && <div className="ok">{msg}</div>}
      <button className="btn wide" disabled={busy || f.pending || owed < min} onClick={collect}>{busy ? <><Spinner /> collecting</> : f.pending ? 'collecting' : 'collect'}</button>
    </div>
  );
}

function Trades({ c, chart }) {
  // every trade on the coin's venue, read from the chain (the site's own trades are among them)
  const rows = chart?.trades?.length ? chart.trades.map((t) => ({ ...t, at: t.ts })) : c.trades;
  if (!rows.length) return <div className="empty">{chart && !chart.complete ? 'reading the trades from the chain…' : 'no trades yet.'}</div>;
  return (
    <div className="tablewrap"><table className="trades">
      <thead><tr><th>account</th><th>type</th><th>SOL</th><th>{c.symbol}</th><th>date</th><th>transaction</th></tr></thead>
      <tbody>
        {rows.map((t) => (
          <tr key={t.sig}>
            <td><i className="avatar" style={{ background: colorOf(t.wallet) }} /> <span className="blue">{shortName(t.wallet)}</span></td>
            <td className={t.side === 'sell' ? 'red' : 'green'}>{t.side}</td>
            <td>{lamportsToSol(t.lamports).toFixed(4)}</td>
            <td>{t.side === 'create' ? '-' : tokens(t.tokenUnits)}</td>
            <td className="muted">{ago(t.at)}</td>
            <td><a className="muted" href={`https://solscan.io/tx/${t.sig}`} target="_blank" rel="noreferrer">{short(t.sig, 3)}</a></td>
          </tr>
        ))}
      </tbody>
    </table></div>
  );
}

function TradePanel({ c, cfg, onTraded }) {
  const w = useWallet();
  const [side, setSide] = useState('buy');
  const [amount, setAmount] = useState('');
  const [pct, setPct] = useState(null);
  const [slippage, setSlippage] = useState('5');
  const [slipOpen, setSlipOpen] = useState(false);
  const [step, setStep] = useState(null);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);

  const trade = async () => {
    setError(null);
    setMsg(null);
    try {
      const wallet = (await w.connect()).acct.address;
      setStep('prepare');
      const body = { wallet, mint: c.mint, side, slippageBps: Math.round((Number(slippage) || 1) * 100) };
      if (side === 'buy') body.amount = Number(amount);
      else if (pct != null) body.pct = pct;
      else body.amount = Number(amount);
      const p = await api.prepareTrade(body);
      setStep('sign');
      const signed = await w.signTransaction(p.transaction);
      setStep('send');
      const r = await api.submitTrade(signed);
      setMsg(`${side === 'buy' ? 'bought' : 'sold'} ${tokens(r.tokenUnits)} ${c.symbol} for ${lamportsToSol(r.lamports).toFixed(4)} SOL`);
      setAmount('');
      setPct(null);
      onTraded();
    } catch (e) {
      setError(cancelled(e) ? 'cancelled in your wallet. nothing was sent.' : e.message);
    } finally {
      setStep(null);
    }
  };
  const win = c.kind === 'window' ? c.window : null;
  const blocked = win ? (win.phase === 'opening' ? 'the anti-snipe tax is on for a few seconds' : win.phase === 'ended' ? 'this window ended with no holders' : win.phase === 'graduated' && (win.venue === 'PumpSwap' || win.pair?.state === 'swapped') ? 'trade this coin on Pumpfun' : win.phase === 'closing' || win.phase === 'graduating' ? 'migrating to Pumpfun: trading resumes there in a few minutes' : null) : c.complete ? 'graduated' : null;
  if (win && win.phase === 'graduated' && (win.venue === 'PumpSwap' || win.pair?.state === 'swapped')) {
    return <div className="panel sm"><div className="muted">this coin trades on Pumpfun.</div><a className="btn wide" href={pumpLink(win.pumpMint)} target="_blank" rel="noreferrer">trade on Pumpfun</a></div>;
  }
  const disabled = Boolean(step) || Boolean(c.quote) || blocked || (side === 'buy' ? !(Number(amount) > 0) : !(pct != null || Number(amount) > 0));
  return (
    <div className="panel">
      <div className="tabbtns">
        <button className={`buy${side === 'buy' ? ' on' : ''}`} onClick={() => { setSide('buy'); setError(null); }}>buy</button>
        <button className={`sell${side === 'sell' ? ' on' : ''}`} onClick={() => { setSide('sell'); setError(null); }}>sell</button>
      </div>
      <div className="row sm" style={{ justifyContent: 'center' }}>
        <button className="btn ghost small" onClick={() => setSlipOpen(true)}>set max slippage</button>
      </div>
      {side === 'buy' ? (
        <>
          <div className="amount"><input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0" disabled={Boolean(step)} /><span className="unit">SOL</span></div>
          <div className="quick">
            <button onClick={() => setAmount('')}>reset</button>
            {[0.1, 0.5, 1].map((v) => <button key={v} onClick={() => setAmount(String(v))}>{v} SOL</button>)}
          </div>
        </>
      ) : (
        <>
          <div className="amount"><input type="number" min="0" value={pct != null ? '' : amount} onChange={(e) => { setPct(null); setAmount(e.target.value); }} placeholder={pct != null ? `${pct}% of your ${c.symbol}` : '0.0'} disabled={Boolean(step)} /><span className="unit">{c.symbol}</span></div>
          <div className="quick">
            <button onClick={() => { setPct(null); setAmount(''); }}>reset</button>
            {[25, 50, 75, 100].map((v) => <button key={v} onClick={() => { setPct(v); setAmount(''); }}>{v}%</button>)}
          </div>
        </>
      )}
      {!win && c.complete && <div className="muted xs">this coin is On Pumpfun: trade it on <a className="green" href={pumpLink(c.mint)} target="_blank" rel="noreferrer">Pumpfun</a>.</div>}
      {win && blocked && win.phase !== 'opening' && <div className="muted xs">{blocked}.</div>}
      {c.quote && <div className="muted xs">this coin is paired with another token: trade it on <a className="green" href={pumpLink(c.mint)} target="_blank" rel="noreferrer">pump.fun</a>.</div>}
      {error && <div className="err">{error}</div>}
      {msg && <div className="ok">{msg}</div>}
      <button className="btn wide" disabled={disabled} onClick={trade}>
        {step === 'prepare' ? <><Spinner /> preparing</> : step === 'sign' ? <><Spinner /> approve in your wallet</> : step === 'send' ? <><Spinner /> sending</> : 'place trade'}
      </button>
      {slipOpen && (
        <Modal onClose={() => setSlipOpen(false)}>
          <h2 style={{ textAlign: 'center' }}>set max slippage (%)</h2>
          <input type="number" min="0.1" max="50" step="0.1" value={slippage} onChange={(e) => setSlippage(e.target.value)} onBlur={() => { const n = Number(slippage); setSlippage(String(n >= 0.1 && n <= 50 ? n : 5)); }} />
          <p className="muted sm">this is the maximum amount of slippage you are willing to accept when placing trades</p>
          <button className="btn" onClick={() => setSlipOpen(false)}>close</button>
        </Modal>
      )}
    </div>
  );
}
