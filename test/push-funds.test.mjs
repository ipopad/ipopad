import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
process.env.VANITY_SUFFIX = 'p';
const { Graduator, isOutOfFunds } = await import('../hk/lib/graduate.mjs');
const { openDb } = await import('../hk/lib/db.mjs');

const setup = (balance, attempts) => {
  const db = openDb(':memory:');
  const owner = Keypair.generate().publicKey.toBase58();
  db.prepare("INSERT INTO pushes (mint, owner, amount, attempts) VALUES ('m', ?, '100', ?)").run(owner, attempts);
  const self = { db, platform: Keypair.generate(), conn: { getBalance: async () => balance, getLatestBlockhash: async () => { throw new Error('should not get this far'); } }, log() {} };
  return { db, self, l: { mint: 'm', pump_mint: Keypair.generate().publicKey.toBase58() } };
};
const row = (db) => db.prepare('SELECT status, attempts FROM pushes').get();

test('a hot wallet short of SOL never gives up on a holder, even one at the retry limit', async () => {
  const { db, self, l } = setup(1000, 6);
  await assert.rejects(Graduator.prototype.step_burned.call(self, l), /too low to push/);
  assert.deepEqual({ ...row(db) }, { status: 'pending', attempts: 6 });
});
test('a refusal for lack of SOL leaves the attempt count alone', async () => {
  const { db, self, l } = setup(10_000_000_000, 2);
  self.sabotage = () => { throw Object.assign(new Error('Transfer: insufficient lamports 5, need 2039280'), { preflight: true }); };
  await assert.rejects(Graduator.prototype.step_burned.call(self, l), /insufficient lamports/);
  assert.deepEqual({ ...row(db) }, { status: 'pending', attempts: 2 });
});
test('another refusal still counts, so a wallet that truly cannot be paid is eventually skipped', async () => {
  const { db, self, l } = setup(10_000_000_000, 2);
  self.sabotage = () => { throw Object.assign(new Error('Transaction simulation failed: InstructionError custom program error'), { preflight: true }); };
  await assert.rejects(Graduator.prototype.step_burned.call(self, l), /InstructionError/);
  assert.deepEqual({ ...row(db) }, { status: 'pending', attempts: 3 });
});
test('a stale blockhash says nothing about the holder: it never counts', async () => {
  const { db, self, l } = setup(10_000_000_000, 2);
  self.sabotage = () => { throw Object.assign(new Error('Transaction simulation failed: Blockhash not found'), { preflight: true }); };
  await assert.rejects(Graduator.prototype.step_burned.call(self, l), /Blockhash/);
  assert.deepEqual({ ...row(db) }, { status: 'pending', attempts: 2 });
});
test('isOutOfFunds reads the message and the logs', () => {
  assert.ok(isOutOfFunds({ message: 'Attempt to debit: insufficient funds for rent' }));
  assert.ok(isOutOfFunds({ message: 'failed', logs: ['Transfer: insufficient lamports 1, need 2'] }));
  assert.ok(!isOutOfFunds({ message: 'custom program error: 0x1' }));
});

test('one holder split into many owners cannot spend past the push budget', async () => {
  const { settleWithinBudget } = await import('../hk/lib/graduate.mjs');
  const allocs = [500n, 400n, 300n, 200n, 100n, 100n];
  const settleAt = (min) => ({ rows: allocs.map((a) => ({ alloc: a >= min ? a : 0n })) });
  const within = settleWithinBudget({ settleAt, minAlloc: 50n, budget: 3 });
  assert.deepEqual(within.rows.filter((r) => r.alloc > 0n).map((r) => r.alloc), [500n, 400n, 300n], 'the largest shares are paid');
  assert.equal(settleWithinBudget({ settleAt, minAlloc: 50n, budget: 6 }).rows.filter((r) => r.alloc > 0n).length, 6, 'an honest list is untouched');
  const ties = (min) => ({ rows: Array.from({ length: 6 }, () => ({ alloc: 100n >= min ? 100n : 0n })) });
  assert.equal(settleWithinBudget({ settleAt, minAlloc: 50n, budget: 0 }).rows.filter((r) => r.alloc > 0n).length, 0, 'a budget of nothing pays nothing, it is not switched off');
  assert.equal(settleWithinBudget({ settleAt, minAlloc: 50n, budget: null }).rows.filter((r) => r.alloc > 0n).length, 6, 'no count recorded leaves it alone');
  assert.equal(settleWithinBudget({ settleAt: ties, minAlloc: 50n, budget: 3 }).rows.filter((r) => r.alloc > 0n).length, 0, 'equal shares past the budget all burn rather than overspend');
});
