import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEE_TIERS, ECONOMICS, tierForCreatorFee, feeStepFor, pairStartSol, splitTax, taxFromEvents } from '../hk/lib/curve.mjs';

test("the curve's fee options are pump.fun's: 0.95% plus the creator fee, whatever Meteora keeps", () => {
  assert.equal(ECONOMICS.tradingFeeBps, FEE_TIERS[0].feeBps);
  assert.equal(ECONOMICS.creatorTradingFeePct, FEE_TIERS[0].creatorPct);
  for (const t of Object.values(FEE_TIERS)) {
    const want = t.creatorBps || 30; // pump.fun's default on the curve is 0.30%
    assert.equal(t.feeBps, 95 + want, t.label);
    const creator = (t.feeBps * 0.8 * t.creatorPct) / 100;
    assert.ok(Math.abs(creator - want) <= 1, `${t.label}: the creator lands on ${creator} bps, wants ${want}`);
    assert.ok(t.feeBps - creator >= 94 && t.feeBps - creator <= 96, `${t.label}: everyone else keeps ${t.feeBps - creator} bps`);
  }
});
test('a creator fee maps to its option; anything pump.fun does not offer has none', () => {
  assert.equal(tierForCreatorFee(0), 0); assert.equal(tierForCreatorFee(undefined), 0);
  assert.equal(tierForCreatorFee(300), 4);
  assert.equal(tierForCreatorFee(75), null);
});
test("a pair's curve is only priced from two fresh, agreeing prices inside pump.fun's range", () => {
  const ok = { units: '4259873', decimals: 8, quoteUsd: 76_900, quoteUsd2: 77_000, solUsd: 92 };
  assert.ok(Math.abs(pairStartSol(ok).vSol - 35.6) < 0.1);
  assert.equal(pairStartSol({ ...ok, quoteUsd2: 90_000 }).why, 'price sources disagree');
  assert.equal(pairStartSol({ ...ok, quoteUsd2: NaN }).why, 'no price');
  assert.equal(pairStartSol({ ...ok, decimals: undefined }).why, 'no price');
  assert.match(pairStartSol({ ...ok, quoteUsd: 10_000, quoteUsd2: 10_000 }).why, /worth/);
});
test('the anti-snipe tax tops holders up first, then follows the creator\'s choice', () => {
  const r = splitTax({ fees: 1_070_000_000n, taxShare: 1_000_000_000n, topUp: 300_000_000n, holderRewards: false });
  assert.deepEqual(r, { tax: 1_000_000_000n, buyExtra: 0n, toCreator: 700_000_000n });
  assert.deepEqual(splitTax({ fees: 1_070_000_000n, taxShare: 1_000_000_000n, topUp: 300_000_000n, holderRewards: true }), { tax: 1_000_000_000n, buyExtra: 700_000_000n, toCreator: 0n });
  assert.equal(splitTax({ fees: 500_000_000n, taxShare: 400_000_000n, topUp: 900_000_000n, holderRewards: false }).toCreator, 0n);
  assert.equal(splitTax({ fees: 100n, taxShare: 900n, topUp: 0n, holderRewards: true }).buyExtra, 100n, 'never more than was claimed');
  assert.equal(splitTax({ fees: 900_000_000n, taxShare: 1_000_000n, topUp: 0n, holderRewards: false }).toCreator, 0n, 'dust stays');
});
test('only buys inside the tax seconds count as tax; the launch transaction and normal trades never do', () => {
  const launchTs = 1000, feeBps = 125, creatorPct = 30, sol = 1_000_000_000n;
  const ev = (time, dQuote, isSwap = true, dVault = dQuote > 0n ? -1n : 1n) => ({ time, dQuote, isSwap, dVault });
  const launch = ev(1000, sol, true, 1000n);
  assert.equal(taxFromEvents({ events: [launch], launchTs, feeBps, creatorPct }), 0n, 'the creator\'s first buy is not tax');
  assert.equal(taxFromEvents({ events: [launch, ev(1003, sol), ev(1500, 50n * sol), ev(1001, -sol), ev(1001, sol, false)], launchTs, feeBps, creatorPct }), 0n, 'after 3 seconds, sells and non-swaps are not tax');
  const first = taxFromEvents({ events: [launch, ev(1000, sol)], launchTs, feeBps, creatorPct });
  assert.ok(Math.abs(Number(first) / 1e9 - (0.99 - 0.0125) * 0.8 * 0.7) < 0.001, `a buy in the first second: ${Number(first) / 1e9}`);
  assert.equal(taxFromEvents({ events: [ev(1000, sol)], launchTs, feeBps, creatorPct }), first, 'a launch with no first buy: the first real buy still counts');
  const later = taxFromEvents({ events: [launch, ev(1002, sol)], launchTs, feeBps, creatorPct });
  assert.ok(later > 0n && later < first / 5n, 'and less each second');
});
test('the launch window cap must be tighter than the 3% wallet cap', async () => {
  const { creatorRules } = await import('../api/creator-rules.mjs');
  assert.throws(() => creatorRules({ earlySecs: 60, earlyMaxWalletBps: 500 }), /tighter than the 3%/);
  assert.equal(creatorRules({ earlySecs: 60, earlyMaxWalletBps: 100 }).earlyMaxWalletBps, 100);
});
test('any creator fee from 0.01% to 3%, like pump.fun: 0.95% plus the fee, and the creator lands within 0.02%', () => {
  for (let b = 1; b <= 300; b++) {
    const t = feeStepFor(b);
    assert.equal(t.feeBps, 95 + b);
    assert.ok(Math.abs((t.feeBps * 0.8 * t.creatorPct) / 100 - b) <= 2, `${b} bps lands on ${(t.feeBps * 0.8 * t.creatorPct) / 100}`);
  }
  assert.equal(feeStepFor(0).feeBps, 125);
  for (const bad of [301, -1, 1.5, 'x']) assert.equal(feeStepFor(bad), null);
});
