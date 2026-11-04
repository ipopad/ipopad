/**
 * Takes a finished test coin off this site completely (operator, 4 Nov 2026): no board, no page, no chart, no image, no metadata.
 * The chain keeps the coin and its metadata address for good: this only ends what the site serves (scripts/remove-coin.mjs also unpins it). Only for the launcher's own
 * coin, and only after its migration has finished. The row stays, marked 'removed', so a restart never lists or registers it again.
 */
import fs from 'node:fs';
import path from 'node:path';
import { one, run, now } from './db.mjs';
import { LOGO_DIR } from './images.mjs';
import { META_DIR } from './launch.mjs';

export function removeCoin({ mint, wallet, ledgerStatus = null }) {
  const row = one('SELECT * FROM launches WHERE mint = ?', mint);
  if (!row) throw new Error(`${mint}: not on this site`);
  if (row.launcher !== wallet) throw new Error(`${mint} (${row.symbol}) was launched by ${row.launcher}, not ${wallet}: refused`);
  if (row.origin === 'official') throw new Error(`${mint} is the official coin: refused`);
  if (row.status === 'removed') return { already: true };
  if (row.kind === 'window' && ledgerStatus !== 'done') throw new Error(`${mint} (${row.symbol}) has not finished migrating (${ledgerStatus ?? 'not in the ledger'}): holders still need its page`);
  const files = [];
  const metaName = String(row.metadata_uri || '').split('/').pop();
  const metaPath = path.join(META_DIR, metaName);
  let imageName = String(row.image || '').split('/').pop();
  if (metaName && fs.existsSync(metaPath)) {
    try { imageName = String(JSON.parse(fs.readFileSync(metaPath, 'utf8')).image || '').split('/').pop() || imageName; } catch {}
    fs.rmSync(metaPath); files.push(metaPath);
  }
  // stored by content: another coin with the same picture keeps it
  const shared = imageName && one("SELECT 1 FROM launches WHERE image LIKE ? AND mint <> ? AND status <> 'removed'", `%${imageName}`, mint);
  if (!shared && /^[0-9a-f]{32}\.(png|jpg|gif|webp)$/.test(imageName)) {
    const base = imageName.slice(0, imageName.lastIndexOf('.'));
    for (const f of [path.join(LOGO_DIR, imageName), path.join(LOGO_DIR, 'sq', `${base}.webp`), path.join(LOGO_DIR, 'sq', `${base}.webp.failed`)]) if (fs.existsSync(f)) { fs.rmSync(f); files.push(f); }
  }
  run('DELETE FROM trades WHERE mint = ?', mint);
  run('DELETE FROM replies WHERE mint = ?', mint);
  run("UPDATE launches SET status = 'removed', updated_at = ? WHERE mint = ?", now(), mint);
  return { symbol: row.symbol, files };
}
