import { useEffect, useState } from 'react';
import { WalletProvider } from './lib/wallet.jsx';
import { usePath } from './lib/router.js';
import { api } from './lib/api.js';
import { WalletPicker } from './components/Chrome.jsx';
import Shell from './components/Shell.jsx';
import Board from './pages/Board.jsx';
import Create from './pages/Create.jsx';
import Coin from './pages/Coin.jsx';
import Docs from './pages/Docs.jsx';
import Explore from './pages/Explore.jsx';
import Analytics from './pages/Analytics.jsx';
import { CrashBoundary } from './components/Crash.jsx';

// the old addresses keep working
if (location.pathname === '/create') history.replaceState({}, '', '/launch');
if (location.pathname === '/how') history.replaceState({}, '', '/docs/how-it-works');

const FALLBACK = { launchReady: false, devBuyReady: false, maxDevBuySol: 50, deployCostSol: 0.025, explorer: 'https://solscan.io', solUsd: null, limits: {} };
const B58 = '[1-9A-HJ-NP-Za-km-z]{32,44}';

function Page({ path, cfg }) {
  if (import.meta.env.DEV && new URLSearchParams(location.search).get('crash') === 'page') throw new Error('crash test');
  if (path === '/') return <Board cfg={cfg} />;
  if (path === '/explore') return <Explore />;
  if (path === '/launch') return <Create cfg={cfg} />;
  if (path === '/analytics') return <Analytics />;
  const m = path.match(new RegExp(`^/coin/(${B58})$`));
  if (m) return <Coin mint={m[1]} cfg={cfg} />;
  return <main className="wrap"><div className="empty" style={{ marginTop: 40 }}>there is nothing at {path}</div></main>;
}

export default function App() {
  const path = usePath();
  if (import.meta.env.DEV && new URLSearchParams(location.search).get('crash') === 'app') throw new Error('crash test');
  const [cfg, setCfg] = useState(FALLBACK);
  useEffect(() => {
    const load = () => api.config().then((c) => setCfg({ ...FALLBACK, ...c })).catch(() => {});
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 60_000);
    return () => clearInterval(t);
  }, []);
  // while launching is closed, a cheap check every 3 s: when $IPO lands, the CA and the open form reach visitors at once
  const closed = cfg.launchOpen === false;
  useEffect(() => {
    if (!closed) return undefined;
    const t = setInterval(() => {
      if (!document.hidden) api.status().then((s) => { if (s.launchOpen) api.config().then((c) => setCfg({ ...FALLBACK, ...c })); }).catch(() => {});
    }, 3_000);
    return () => clearInterval(t);
  }, [closed]);
  return (
    <WalletProvider>
      <div className="bgfx" aria-hidden="true" />
      {path === '/docs' || path.startsWith('/docs/')
        ? <CrashBoundary key={path} inPage><Docs path={path} cfg={cfg} /></CrashBoundary>
        : <Shell path={path}><CrashBoundary key={path} inPage><Page path={path} cfg={cfg} /></CrashBoundary></Shell>}
      <WalletPicker />
    </WalletProvider>
  );
}
