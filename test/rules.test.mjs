import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
process.env.DB_PATH = '/tmp/ipo-rules-test.db';
const { creatorRules, publicRules, anyCreatorRule, CREATOR_RULE_KEYS } = await import('../api/creator-rules.mjs');
const { DEFAULT_RULES, encodeRules, decodeRules } = await import('../hk/lib/rules.mjs');
const { DEFAULT_FORM, toRules, withRule, describeRules, parseWallets, CATALOG } = await import('../web/src/lib/rulesText.js');

const DEV = new PublicKey('11111111111111111111111111111112');
const onChain = (creator) => decodeRules(encodeRules({ ...DEFAULT_RULES, ...creator, dev: DEV, platformOn: true, platform: DEV, openSecs: 5, closeSecs: 0, tradeGuardBps: 300, maxWalletBps: 300 }));

test('creatorRules: nothing sent = nothing on; unknown fields ignored; the window max per wallet carried', () => {
  assert.deepEqual(creatorRules(undefined), {});
  assert.deepEqual(creatorRules({ kingOn: true, fomoOnly: true, platformOn: false, feeCapBps: 500, plagueDose: 1e6 }), {}); // never creator-settable
    assert.equal(anyCreatorRule({}), false);
  assert.equal(anyCreatorRule({ maxWalletBps: 100 }), true);
});
test('creatorRules: ranges and clashes refused in the form\'s words', () => {
  assert.deepEqual(creatorRules({ maxBuyBps: 100, maxSellBps: 50, tradeGuardBps: 9000 }), {}); // the 3% guard is fixed: a creator cannot set any of these
  assert.throws(() => creatorRules({ hoursDays: 62 }), /without the rule/);
  assert.throws(() => creatorRules({ rampSecs: 'abc' }), /whole number/);
  assert.throws(() => creatorRules({ hoursDst: 7 }), /out of range/);
  assert.deepEqual(creatorRules({ oscKind: 2, oscPeriod: 120, potatoOn: true, pingOn: true }), {}); // oscillators and games are not offered
  assert.throws(() => creatorRules([1]), /object/);
});
test('every picked rule in the form encodes, decodes and reads back the same (and the hook accepts it)', () => {
  for (const x of CATALOG) {
    const form = withRule({ ...DEFAULT_FORM, listText: '' }, x.id, true);
    const maxWallet = 3;
    const sent = toRules(form, maxWallet);
    const clean = creatorRules(sent, { maxWalletBps: maxWallet * 100 });
    const back = publicRules(onChain(clean));
    assert.ok(back.any, `${x.id} reads back as on`);
    for (const k of CREATOR_RULE_KEYS) assert.equal(back[k], clean[k] ?? (typeof back[k] === 'boolean' ? false : 0), `${x.id}: ${k} survives the chain`);
    assert.ok(back.lines.length >= 1 && back.lines.some((l) => l.t !== 'creator\'s wallet'), `${x.id} is described: ${back.lines.map((l) => l.t).join(', ')}`);
    assert.deepEqual(back.lines, describeRules(sent), `${x.id}: the modal's words are the coin page's words`);
  }
});
test('market hours read back as market hours, with daylight saving and holidays', () => {
  const form = withRule(DEFAULT_FORM, 'market', true);
  const back = publicRules(onChain(creatorRules(toRules(form))));
  assert.ok(back.hoursHolidays && back.hoursDst === 1 && back.tzOffsetMin === -300 && back.hoursDays === 62);
  assert.match(back.lines.find((l) => /monday/.test(l.d))?.d ?? "", /monday to friday, 09:30 to 16:00 \(New York time\), and not on US stock market holidays/);
});
test('clashing picks switch each other off', () => {
  let f = withRule(DEFAULT_FORM, 'hours', true); f = withRule(f, 'market', true);
  assert.ok(f.on.market && !f.on.hours && f.tz === -300 && f.hoursDst === 1);
});
test('parseWallets: unique, reports junk', () => {
  const r = parseWallets(`${DEV.toBase58()}\n${DEV.toBase58()}, nope`);
  assert.deepEqual(r.wallets, [DEV.toBase58()]); assert.deepEqual(r.invalid, ['nope']);
});

test('the form offers only anti-bundle and trade only; anything else a request sends is dropped', async () => {
  const { OFFERED_CATALOG } = await import('../web/src/lib/rulesText.js');
  const { offeredRules } = await import('../api/creator-rules.mjs');
  assert.deepEqual(OFFERED_CATALOG.map((x) => x.id).sort(), ['antiBundle', 'dexOnly']);
  assert.deepEqual(offeredRules({ bundleMax: 1, dexOnly: true, allowlist: true, hoursOn: true, sellBagBps: 100 }, false), { bundleMax: 1, dexOnly: true });
  assert.deepEqual(offeredRules({}, false), {});
});
