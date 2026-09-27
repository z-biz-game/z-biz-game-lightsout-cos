// The generator, and the ladder of difficulty bands it fills.
//
// Generation is trivially sound: start from the all-dark board and press k distinct keys.
// The result is M*x for some x, hence inside the column space, hence solvable by
// construction — no rejection loop, no retry. What is *not* trivial is the par: pressing
// k keys does not mean k is optimal, because ker(M) is nonzero (nullity 4 on 4x4, 2 on
// 5x5). A board can quietly have a shorter solution than the key set that produced it —
// on 4x4, pressing 8 keys can leave a board that dies in 4.
//
// So a band is defined by the MEASURED par window, and `keys` is only the dial used to hit
// it: for k <= 4 on 4x4 and k <= 7 on 5x5 no kernel vector is light enough to undercut k,
// which is what makes the two easy bands land near 100%; the harder bands dial k upwards
// and eat real rejections, and tools/bake.mjs prints those counts instead of hiding them.
// A band whose window is a single par value cannot be missed at all, which is why the
// windows here are narrow and why the acceptance rate is a measurement, not a hope.
//
// Nothing here is allowed to run on a tap: this file is imported by tools/bake.mjs and by
// test/make.test.mjs only.

import { rngFrom } from './rng.js';
import { flipMasks, bitCount, boardToNumber, allDark } from './grid.js';
import { solve, isSolvable } from './solve.js';

export const TIERS = [
  { key: 'faint', label: '微光', n: 4, keys: [2, 3], par: [2, 3] },
  { key: 'dim', label: '昏黄', n: 4, keys: [4, 8], par: [4, 7] },
  { key: 'shadow', label: '暗影', n: 5, keys: [8, 12], par: [8, 10] },
  { key: 'blackout', label: '全熄', n: 5, keys: [11, 17], par: [11, 15] },
];

// The only reasons a candidate board is not shipped. bake.mjs counts them; a new reason
// has to be added here so the printed tally stays exhaustive.
export const REJECT_REASONS = ['out_of_band', 'empty', 'duplicate', 'unsolvable'];

export function tierByKey(key) {
  const t = typeof key === 'object' && key ? key : TIERS.find((x) => x.key === key);
  if (!t) throw new Error(`unknown tier ${key}; TIERS = ${TIERS.map((x) => x.key).join(', ')}`);
  return t;
}

// makePuzzle(seed, tier) -> { ok: true, tier, n, board, par, pattern, keys, rank, nullity, lit }
//                        or { ok: false, reason, tier, n, par }
// Deterministic: the same (seed, tier) pair is the same board forever, which is what makes
// #/daily and a shared link mean the same puzzle on every device. `board` is a decimal
// string because a 5x5 board is 25 bits and a 7x7 one would be 49 — beyond a JS number.
export function makePuzzle(seed, tier) {
  const t = tierByKey(tier);
  const rng = rngFrom(`${t.key}|${seed}`);
  const cols = flipMasks(t.n);
  const k = t.keys[0] + rng.int(t.keys[1] - t.keys[0] + 1);
  const chosen = new Set();
  while (chosen.size < k) chosen.add(rng.int(t.n * t.n));
  // Generation starts where the rules start: the all-dark n×n board (`allDark`), from which
  // the chosen keys are pressed. Nothing is "generated" by search.
  let board = allDark(t.n);
  for (const j of chosen) board ^= cols[j];

  // Kernel vectors are all heavier than any k in these bands' dials, so XORing one on can
  // never raise the count above k; it can only lower it. Hence par <= k <= size, and the
  // all-dark board is unreachable from a nonempty key set — but check rather than assume.
  if (board === allDark(t.n)) return { ok: false, reason: 'empty', tier: t.key, n: t.n, par: 0, keys: k };
  // Construction guarantees solvability; the guard stays because "unsolvable boards never
  // ship" is a claim this file has to keep earning.
  if (!isSolvable(board, t.n)) {
    return { ok: false, reason: 'unsolvable', tier: t.key, n: t.n, board: boardToNumber(board), keys: k };
  }
  const r = solve(board, t.n);
  if (r.presses < t.par[0] || r.presses > t.par[1]) {
    return { ok: false, reason: 'out_of_band', tier: t.key, n: t.n, par: r.presses, keys: k };
  }
  return {
    ok: true,
    tier: t.key,
    n: t.n,
    board: boardToNumber(board),
    par: r.presses,
    pattern: r.pattern,
    keys: k,
    rank: r.rank,
    nullity: r.nullity,
    lit: bitCount(board),
  };
}
