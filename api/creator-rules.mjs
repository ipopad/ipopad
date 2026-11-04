// The hook rules a creator may set on a window launch (`window.rules` in /api/launch/prepare): a whitelist of the
// fields hk/lib/rules.mjs knows, coerced to whole numbers, checked by the same `validateRules` the launch builder runs,
// with the window's own fixed rules (platform wallet, opening delay, the 3% trade guard, the 3% max per wallet) laid over them so a creator
// can never switch those off or on. Everything else in DEFAULT_RULES stays off.
import { PublicKey } from '@solana/web3.js';
import { ApiError } from './errors.mjs';
import { DEFAULT_RULES, validateRules } from '../hk/lib/rules.mjs';
import { describeRules } from '../web/src/lib/rulesText.js';

/** field → kind: 'bool' | 'int' (a whole number, at most this big; ranges proper are validateRules's). */
const FIELDS = {
  maxWalletBps: 10_000, earlySecs: 86_400, earlyMaxWalletBps: 10_000, rampStartBps: 10_000, rampSecs: 7 * 86_400, bundleMax: 1,
  allowlist: 'bool', blocklist: 'bool',
  hoursOn: 'bool', hoursDays: 127, hoursOpenMin: 1_439, hoursCloseMin: 1_439, tzOffsetMin: [-720, 840], hoursDst: 2, hoursSells: 'bool', hoursHolidays: 'bool',
  sellSmallBps: 10_000, sellFloorBps: 10_000, sellBagBps: 10_000,
  dexOnly: 'bool',
};
export const CREATOR_RULE_KEYS = Object.freeze(Object.keys(FIELDS));
/** What a window launch always has, whatever the creator sends (api/window.mjs lays the real values over these). */
export const MAX_WALLET_BPS = 300; // operator, 4 Nov 2026: at most 3% of supply per wallet, every coin, the whole curve
export const TRADE_GUARD_BPS = 300; // operator, 4 Nov 2026: every coin, exactly 3%; replaces the creator's trade guard and anti-dump rules
const FIXED = Object.freeze({ tradeGuardBps: TRADE_GUARD_BPS, maxWalletBps: MAX_WALLET_BPS, fomoOnly: false, appOnly: false, venueLock: false, platformOn: true, feeBaseBps: 0, feePerSolBps: 0, feeCapBps: 0, burnBps: 0, holderShareBps: 0, kingOn: false, kingMinLamports: 0, kingBeatPct: 0, kingDecayUnit: 0, kingDecayN: 0, kingDevCan: false, p2pOnly: false });
const DUMMY = new PublicKey('11111111111111111111111111111112'); // validateRules wants a dev and a platform; the real ones come at build

/**
 * The creator's rules, cleaned: only known fields, whole numbers, every rule off unless set. Throws an ApiError naming the
 * first problem, in the words the form shows. `maxWalletBps` may also arrive as the window's own max per wallet.
 */
export function creatorRules(raw, { maxWalletBps = 0 } = {}) {
  const out = {};
  if (raw != null && (typeof raw !== 'object' || Array.isArray(raw))) throw new ApiError('rules must be an object');
  for (const [k, kind] of Object.entries(FIELDS)) {
    const v = raw?.[k];
    if (v == null) continue;
    if (kind === 'bool') { out[k] = v === true || v === 1 || v === 'true'; continue; }
    const n = Number(v);
    if (!Number.isInteger(n)) throw new ApiError(`rule ${k} must be a whole number`);
    const [lo, hi] = Array.isArray(kind) ? kind : [0, kind];
    if (n < lo || n > hi) throw new ApiError(`rule ${k} is out of range`);
    out[k] = n;
  }
  if (out.maxWalletBps == null && maxWalletBps) out.maxWalletBps = maxWalletBps;
  if (out.earlyMaxWalletBps > MAX_WALLET_BPS) throw new ApiError('The launch window cap must be tighter than the 3% max per wallet.');
  // chapters replace the max per wallet (the hook refuses both); the form sends one or the other but a hand-rolled client may not
  const errs = validateRules({ ...DEFAULT_RULES, ...out, ...FIXED, dev: DUMMY, platform: DUMMY, openSecs: 5, closeSecs: 0 });
  if (errs.length) throw new ApiError(errs[0]);
  return out;
}

/** Only what the launch form offers right now: anything else a hand-built request sends is dropped. ALL_RULES=1 is for the rules test suite. */
export const offeredRules = (rules, all = process.env.ALL_RULES === '1') => {
  if (all) return rules;
  const out = {};
  for (const k of ['bundleMax', 'dexOnly']) if (rules?.[k]) out[k] = rules[k];
  return out;
};

/** True when any creator rule is on (the launch needs more than the window's fixed rules). */
export const anyCreatorRule = (r) => CREATOR_RULE_KEYS.some((k) => r?.[k] === true || (typeof r?.[k] === 'number' && r[k] > 0));

/** The creator-settable rules of a decoded on-chain config, for the coin page: the numbers and the words. */
export function publicRules(decoded) {
  if (!decoded) return null;
  const r = {};
  for (const k of CREATOR_RULE_KEYS) r[k] = decoded[k] ?? (FIELDS[k] === 'bool' ? false : 0);
  r.maxWalletBps = decoded.maxWalletBps ?? 0;
  r.tradeGuardBps = decoded.tradeGuardBps ?? 0; // fixed, not the creator's, but the coin page shows it
  return { ...r, lines: describeRules(r), any: anyCreatorRule(r) };
}
