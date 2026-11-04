import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
process.env.DB_PATH = '/tmp/ipo-ticker-test.db';
for (const f of ['', '-wal', '-shm']) fs.rmSync(process.env.DB_PATH + f, { force: true });
const { tickerFeeUntil, tickerStatus, TICKER_FEE_MS } = await import('../api/launch.mjs');
const { run, now } = await import('../api/db.mjs');
const row = (mint, symbol, status, agoMs, paid = 0) => run(`INSERT INTO launches (mint, launcher, name, symbol, metadata_uri, status, created_at, bumped_at, updated_at, ticker_fee) VALUES (?, 'w', 'n', ?, 'u', ?, ?, ?, ?, ?)`, mint, symbol, status, now() - agoMs, now(), now(), paid);

test('a ticker costs 1 SOL to launch again for 24 hours after it launched, then it is free', () => {
  row('m1', 'PEPE', 'live', 3_600_000);
  assert.ok(tickerFeeUntil('pepe') > now(), 'case does not make a new ticker');
  assert.equal(tickerFeeUntil('DOGE'), null, 'another ticker is free');
  row('m2', 'OLD', 'live', TICKER_FEE_MS + 1000);
  assert.equal(tickerFeeUntil('OLD'), null, 'free after 24 hours');
});
test('only real free launches start the 24 hours', () => {
  row('m3', 'BAD', 'failed', 1000); assert.equal(tickerFeeUntil('BAD'), null, 'a failed launch does not');
  row('m4', 'PREP', 'prepared', 1000); assert.equal(tickerFeeUntil('PREP'), null, 'an unsigned prepare does not: nobody can make a stranger pay');
  row('m5', 'GONE', 'removed', 1000); assert.equal(tickerFeeUntil('GONE'), null, 'a removed test coin does not');
  row('m6', 'HID', 'hidden', 1000); assert.ok(tickerFeeUntil('HID'), 'a hidden coin does');
  row('m7', 'CONF', 'created', 1000); assert.ok(tickerFeeUntil('CONF'), 'a confirming coin does');
});
test('a paid copy does not restart the 24 hours', () => {
  row('m8', 'ROLL', 'live', 20 * 3_600_000);
  const until = tickerFeeUntil('ROLL');
  row('m9', 'ROLL', 'live', 1000, 1);
  assert.equal(tickerFeeUntil('ROLL'), until);
  row('m10', 'ROLL2', 'live', TICKER_FEE_MS + 1000); row('m11', 'ROLL2', 'live', 1000, 1);
  assert.equal(tickerFeeUntil('ROLL2'), null, 'the first day is over, a paid copy keeps it free');
});
test('the create page hint', () => {
  row('m12', 'HINT', 'live', 22 * 3_600_000);
  const t = tickerStatus(' hint ');
  assert.equal(t.feeSol, 1); assert.match(t.text, /\$HINT launched here .* costs 1 SOL for the next 2 hours, then it is free/);
  assert.deepEqual(tickerStatus('not a ticker!'), { symbol: 'NOT A TICKER!', feeSol: 0, until: null, text: null });
  assert.equal(tickerStatus('FREE').feeSol, 0);
});
