// One watchdog pass (ipo-watchdog.timer, every 2 minutes; it exits when done). It runs outside the graduator, so a dead or hung graduator is
// still reported. Problems reach Discord through ALERT_WEBHOOK in the box's .env (hk/lib/alert.mjs): once when they appear, again every 6 hours
// while they last, and a line when they clear. Once a day a summary, so silence means the watchdog itself is gone.
//   node scripts/watchdog.mjs          one pass
//   node scripts/watchdog.mjs --test   send a test line
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { Connection, Keypair } from '@solana/web3.js';
import { findProblems, plan, settle, deliver, channels, GRADUATING } from '../hk/lib/alert.mjs';

const log = (...a) => console.log(new Date().toISOString(), ...a);
const DATA = process.env.DATA_DIR || 'data', PORT = process.env.PORT || 5560;
const ch = channels();
if (!ch.webhook && !ch.telegram) log('no ALERT_WEBHOOK set: problems are logged only');

if (process.argv.includes('--test')) {
  const ok = await deliver('🔔 test alert from the IPO watchdog. If you can read this, alerts reach you.', { ch, log });
  log(ok ? 'test alert sent' : 'test alert NOT delivered');
  process.exit(ok ? 0 : 1);
}

const nowMs = Date.now(), nowSec = Math.floor(nowMs / 1000);
const statePath = `${DATA}/alerts.json`;
let state = {};
try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch {}

const open = (f) => { const d = new DatabaseSync(`${DATA}/${f}`, { readOnly: true }); d.exec('PRAGMA busy_timeout = 10000'); return d; };
const ledger = open('ledger.db');
const heartbeat = ledger.prepare('SELECT heartbeat FROM lock WHERE id = 1').get()?.heartbeat ?? null;
const launches = ledger.prepare(`SELECT * FROM launches WHERE status = 'stalled' OR status IN (${GRADUATING.map(() => '?').join(',')})`).all(...GRADUATING);
const counts = Object.fromEntries(ledger.prepare('SELECT status, COUNT(*) n FROM launches GROUP BY status').all().map((r) => [r.status, r.n]));
const failedPushes = ledger.prepare("SELECT COUNT(*) AS n FROM pushes WHERE status = 'failed'").get().n;
const inLedger = new Set(ledger.prepare('SELECT mint FROM launches').all().map((r) => r.mint));
ledger.close();
const site = open('ipo.db');
const kv = (k) => { try { return JSON.parse(site.prepare('SELECT value FROM kv WHERE key = ?').get(k)?.value ?? 'null'); } catch { return null; } };
const officialLive = kv('officialLive'), launchOpen = Boolean(kv('launchOpen'));
const live = site.prepare("SELECT COUNT(*) AS n FROM launches WHERE status = 'live' AND kind = 'window'").get().n;
const unregistered = site.prepare("SELECT mint, symbol FROM launches WHERE status IN ('live', 'hidden') AND kind = 'window' AND created_at < ?").all(nowMs - 600_000).filter((r) => !inLedger.has(r.mint));
const officialRow = officialLive ? site.prepare('SELECT symbol FROM launches WHERE mint = ?').get(officialLive.mint) : null;
site.close();

let api = { ok: false, why: 'no answer' }, addresses = null;
try {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/ops`, { signal: AbortSignal.timeout(15_000) });
  api = { ok: r.status < 500, why: `HTTP ${r.status}` };
  if (r.ok) addresses = (await r.json()).addressesReady;
} catch (e) { api = { ok: false, why: String(e.cause?.code ?? e.name ?? e).slice(0, 60) }; }

// one balance read at most every 10 minutes
let hotLamports = state._hot?.lamports ?? null, hotWallet = null;
try { hotWallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(`${DATA}/platform.json`, 'utf8')))).publicKey; } catch {}
if (hotWallet && process.env.SOLANA_RPC && (!state._hot || nowMs - state._hot.at > 600_000)) {
  try { hotLamports = await new Connection(process.env.SOLANA_RPC, 'confirmed').getBalance(hotWallet, 'confirmed'); state._hot = { lamports: hotLamports, at: nowMs }; }
  catch { log('hot wallet balance unreadable'); hotLamports = null; }
}

const problems = findProblems({ nowSec, heartbeat, apiOk: api.ok, apiWhy: api.why, gateExpected: false, launches, hotLamports, hotLowLamports: Math.round(Number(process.env.HOT_LOW_SOL ?? 0.35) * 1e9), hotWallet: hotWallet?.toBase58() });
const ADDRESS_LOW = Number(process.env.ADDRESS_LOW ?? 100);
if (addresses != null && addresses < ADDRESS_LOW) problems.push({ key: 'addresses-low', text: `⚠ Only ${addresses} ipo addresses are ready (alert under ${ADDRESS_LOW}). Launches pause at 0. The box refills slowly: grind more on the Mac if this keeps falling.` });
// a heartbeat proves the process lives, not that its passes finish
let lastPass = null;
try { lastPass = fs.statSync(`${DATA}/graduator-pass`).mtimeMs; } catch {}
if (lastPass && nowMs - lastPass > 15 * 60_000) problems.push({ key: 'passes-failing', text: `⚠ The graduator has not finished a pass for ${Math.round((nowMs - lastPass) / 60_000)} min: filled curves may be waiting. Check its log (pass failed).` });
for (const r of unregistered) problems.push({ key: `unregistered:${r.mint}`, text: `⚠ $${r.symbol} ${r.mint} is live but the graduator does not know it, so it would never migrate. Check api/launch.mjs reconcile and the server log.` });
// the nightly copy off the server. Only once one has ever run: the Mac may simply be off for a night
let lastBackup = null;
try { lastBackup = fs.statSync(`${DATA}/last-backup`).mtimeMs; } catch {}
const BACKUP_MAX_H = Number(process.env.BACKUP_MAX_HOURS ?? 48);
if (lastBackup && nowMs - lastBackup > BACKUP_MAX_H * 3_600_000) problems.push({ key: 'backup-stale', text: `⚠ The newest backup is ${Math.round((nowMs - lastBackup) / 3_600_000)} hours old. Check the machine that makes them.` });
// a deploy restarts the graduator: the lock is free for a moment. Only a second pass in a row is news
const downAt = problems.findIndex((p) => p.key === 'graduator-down');
const graduatorDownBefore = Boolean(state._graduatorDown);
if (downAt >= 0 && !graduatorDownBefore) problems.splice(downAt, 1);
const graduatorDownNow = downAt >= 0;
for (const p of problems) log(p.text);

const { messages, next } = plan(problems, state, nowMs);
const results = new Map();
for (const m of messages) {
  const ok = await deliver(m.text, { ch, log });
  results.set(m.key, ok);
  log(`${ok ? 'sent' : 'NOT sent'}: ${m.text.slice(0, 100)}`);
}
settle(next, results, nowMs);
if (graduatorDownNow) next._graduatorDown = true; else delete next._graduatorDown;
// an event, not a state: once, and counted only when it was really sent
if (failedPushes > (next._failedPushes ?? 0) && (ch.webhook || ch.telegram)) {
  if (await deliver(`⚠ ${failedPushes} holder payout(s) in total were given up on and their coins burned. Check why: bash deploy/ops.sh, then the graduator log.`, { ch, log })) next._failedPushes = failedPushes;
}

// good news once: $IPO landed and launching is open to everyone
if (officialLive && !next._officialSeen && (ch.webhook || ch.telegram)) {
  if (await deliver(`🚀 $${officialRow?.symbol ?? 'IPO'} landed and launching is OPEN: ${officialLive.mint}`, { ch, log })) next._officialSeen = officialLive.mint;
}

const day = new Date(nowMs).toISOString().slice(0, 10), hour = new Date(nowMs).getUTCHours();
if (hour >= Number(process.env.ALERT_DAILY_HOUR ?? 8) && next._daily?.day !== day && (ch.webhook || ch.telegram)) {
  const line = `${problems.length ? `⚠ ${problems.length} open problem(s)` : '✅ all well'} · launching ${launchOpen ? 'open' : 'closed'} · hot wallet ${hotLamports == null ? '?' : (hotLamports / 1e9).toFixed(3)} SOL · addresses ${addresses ?? '?'} · coins ${live} · on curves ${counts.trading ?? 0} · migrated ${counts.done ?? 0}`;
  if (await deliver(`daily: ${line}`, { ch, log })) next._daily = { day };
}

fs.writeFileSync(`${statePath}.tmp`, JSON.stringify(next, null, 1), { mode: 0o600 });
fs.renameSync(`${statePath}.tmp`, statePath);
if (!problems.length) log('ok');
process.exit(0);
