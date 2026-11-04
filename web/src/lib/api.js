async function req(path, opts = {}) {
  let r;
  try { r = await fetch(path, { cache: 'no-store', ...opts }); }
  catch { throw Object.assign(new Error('Could not reach the server. Try again in a moment.'), { network: true }); } // never the browser's bare "Failed to fetch"
  const text = await r.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok) throw Object.assign(new Error(body?.error || `Request failed (${r.status})`), { status: r.status, stage: body?.stage ?? null });
  return body;
}
const post = (path, data) => req(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });

export const api = {
  analytics: () => req('/api/analytics'),
  config: () => req('/api/config'),
  status: () => req('/api/status'),
  stats: () => req('/api/stats'),
  configFor: (wallet) => req(`/api/config?wallet=${encodeURIComponent(wallet)}`),
  pairs: () => req('/api/pairs'),
  pair: (mint) => req(`/api/pairs/${mint}`),
  pairCurve: (mint) => req(`/api/pairs/${mint}/curve`),
  coins: (sort, order, q) => req(`/api/coins?sort=${sort}&order=${order}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
  coin: (mint) => req(`/api/coins/${mint}`),
  chart: (mint, interval) => req(`/api/coins/${mint}/chart${interval ? `?interval=${interval}` : ''}`),
  ticker: () => req('/api/ticker'),
  collectCreatorFee: (mint, data) => post(`/api/coins/${mint}/creator-fee`, data),
  tickerStatus: (symbol) => req(`/api/launch/ticker?symbol=${encodeURIComponent(symbol)}`),
  prepareLaunch: (form) => post('/api/launch/prepare', form),
  submitLaunch: (mint, transaction) => post('/api/launch/submit', { mint, transaction }),
  listTxs: (data) => post('/api/launch/list', data),
  submitList: (mint, transaction) => post('/api/launch/list/submit', { mint, transaction }),
  prepareTrade: (data) => post('/api/trade/prepare', data),
  submitTrade: (transaction) => post('/api/trade/submit', { transaction }),
};
