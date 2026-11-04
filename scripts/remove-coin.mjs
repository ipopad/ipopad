#!/usr/bin/env node
// Takes a finished test coin off the site for good: node scripts/remove-coin.mjs <mint> <launcher wallet>
import { removeCoin } from '../api/remove-coin.mjs';
import { ledger } from '../api/window.mjs';
import { one } from '../api/db.mjs';
import { unpinMetadata } from '../api/launch.mjs';
const [mint, wallet] = process.argv.slice(2);
if (!mint || !wallet) { console.log('usage: node scripts/remove-coin.mjs <mint> <launcher wallet>'); process.exit(1); }
try {
  const l = ledger.prepare('SELECT status FROM launches WHERE mint = ?').get(mint);
  const uri = one('SELECT metadata_uri AS u FROM launches WHERE mint = ?', mint)?.u;
  const r = removeCoin({ mint, wallet, ledgerStatus: l?.status ?? null });
  const unpinned = r.already ? null : await unpinMetadata(uri).catch((e) => `failed: ${e.message}`);
  console.log(JSON.stringify({ ...r, unpinned }));
  process.exit(0);
} catch (e) { console.error(e.message); process.exit(1); }
