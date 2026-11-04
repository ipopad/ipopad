import { useEffect } from 'react';
import { useWallet } from '../lib/wallet.jsx';
import { ago } from '../lib/format.js';

export const Pill = () => (
  <svg viewBox="0 0 64 64" aria-hidden="true"><g transform="rotate(-45 32 32)"><rect x="10" y="22" width="44" height="20" rx="10" fill="#86efac" /><path d="M32 22h12a10 10 0 0 1 0 20H32z" fill="#fff" /></g></svg>
);
export const XIcon = () => <svg className="icon" viewBox="0 0 24 24"><path d="M18.9 2H22l-7.6 8.7L23.3 22h-7l-5.5-7.2L4.5 22H1.4l8.1-9.3L.8 2h7.2l5 6.6L18.9 2zm-1.2 18h1.9L7.4 3.9H5.3L17.7 20z" /></svg>;
export const GhIcon = () => <svg className="icon" viewBox="0 0 24 24"><path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.04 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.58.23 2.75.11 3.04.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.39-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" /></svg>;
export const SOCIAL_X = 'https://x.com/LaunchOnIPO';
export const SOCIAL_GH = 'https://github.com/ipopad/ipopad';

export function Modal({ onClose, children, wide = false }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={wide ? { maxWidth: 580 } : undefined} role="dialog">{children}</div>
    </div>
  );
}

export function WalletPicker() {
  const w = useWallet();
  if (!w.picker) return null;
  return (
    <Modal onClose={w.closePicker}>
      <h2 style={{ textAlign: 'center' }}>connect your wallet</h2>
      {w.providers.length === 0 && <p className="muted">No Solana wallet was found in this browser. Install Phantom, Solflare or Backpack and reload.</p>}
      {w.providers.map((p) => (
        <button key={p.name} className="walletrow" disabled={w.busy} onClick={() => w.connectWith(p).catch(() => {})}>
          {p.icon && <img src={p.icon} alt="" />}<span className="b">{p.name}</span>
        </button>
      ))}
      {w.error && <div className="err">{w.error}</div>}
    </Modal>
  );
}

/** A short status line that disappears. */
export function Toast({ text }) {
  if (!text) return null;
  return <div className="toast">{text}</div>;
}

export function Spinner({ light = false }) {
  return <span className={`spin${light ? ' light' : ''}`} />;
}
export { ago };
