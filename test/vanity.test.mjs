import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Keypair } from '@solana/web3.js';
process.env.VANITY_SUFFIX = 'a'; process.env.VANITY_LAUNCH_SUFFIX = 'b';
const v = await import('../hk/lib/vanity.mjs');
const grind = (s) => { for (;;) { const k = Keypair.generate(); if (k.publicKey.toBase58().endsWith(s)) return k; } };

test('curve tokens and pump.fun coins come from separate suffixes, and the graduation reserve is kept', () => {
  const db = new DatabaseSync(':memory:'); v.initVanity(db);
  assert.throws(() => v.addKey(db, grind('c')), /not a/);
  for (let i = 0; i < 3; i++) v.addKey(db, grind('a'));
  assert.equal(v.availableForLaunch(db, 1), 0, 'no curve key yet');
  assert.equal(v.issueForLaunch(db, 'w1', null, 1), null);
  v.addKey(db, grind('b')); v.addKey(db, grind('b'));
  assert.equal(v.availableForLaunch(db, 1), 2);
  assert.ok(v.issueForLaunch(db, 'w1', null, 1).publicKey.toBase58().endsWith('b'), 'a launch gets a curve key');
  assert.ok(v.takeForGraduation(db, 'mint1').publicKey.toBase58().endsWith('a'), 'a graduation gets a pump.fun coin key');
  assert.ok(v.takeForGraduation(db, 'mint2').publicKey.toBase58().endsWith('a'));
  assert.equal(v.availableForLaunch(db, 1), 0, 'the last pump.fun coin key is held for a graduation');
  assert.equal(v.issueForLaunch(db, 'w2', null, 1), null);
  assert.ok(v.takeForGraduation(db, 'mint3').publicKey.toBase58().endsWith('a'), 'and a graduation may still use it');
});
