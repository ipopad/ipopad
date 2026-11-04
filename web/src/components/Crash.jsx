import { Component } from 'react';

/** What a visitor sees when a render fails. Its styles live in index.html, so it still looks right if the stylesheet is what broke. */
export function CrashPage({ inPage = false }) {
  return (
    <main className={`crash${inPage ? ' in-page' : ''}`} role="alert">
      <img className="crash-mark" src="/icon-192.png" alt="" width="72" height="72" />
      <h1>Something broke on this page</h1>
      <p>This is a display problem. Your wallet and your coins are on chain and are not affected. Reloading usually brings it back.</p>
      <div className="crash-row">
        <button className="crash-btn" onClick={() => window.location.reload()}>Reload</button>
        <a className="crash-btn quiet" href="/">Go home</a>
      </div>
      <a className="crash-help" href="https://x.com/LaunchOnIPO" target="_blank" rel="noreferrer">Still broken? Tell us on X</a>
    </main>
  );
}

/** Catches render errors below it. Give it key={path} around a page so moving to another page clears the error. */
export class CrashBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error, info) { console.error('[crash]', error, info?.componentStack); }
  render() { return this.state.failed ? <CrashPage inPage={this.props.inPage} /> : this.props.children; }
}
