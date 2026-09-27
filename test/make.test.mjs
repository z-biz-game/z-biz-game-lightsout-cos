// The generator: a dial that lands inside a measured par window, and a rejection path that
// actually rejects. The band gate is tested with a window it cannot satisfy — that is the
// negative case the contract asks for, and it is what proves the window is enforced rather
// than decorative.

import { test, run, ok, eq } from '../tools/harness.mjs';
import { TIERS, REJECT_REASONS, makePuzzle, tierByKey } from '../js/core/make.js';
import { solve } from '../js/core/solve.js';
import { getSolver } from '../js/core/gf2.js';
import { boardOf, applyPattern, bitCount } from '../js/core/grid.js';
import { RANK_TABLE } from './fixture.mjs';

test('the ladder is four bands, each with a key dial and a measured par window', () => {
  eq(TIERS.map((t) => t.key), ['faint', 'dim', 'shadow', 'blackout']);
  eq(TIERS.map((t) => t.n), [4, 4, 5, 5], 'two sizes, and only the ones the rank table covers');
  for (const t of TIERS) {
    ok(t.keys[0] <= t.keys[1], `${t.key} dial is inverted`);
    ok(t.par[0] <= t.par[1], `${t.key} window is inverted`);
    ok(t.keys[1] <= t.n * t.n, `${t.key} cannot dial past the number of keys`);
    ok(t.par[1] <= t.n * t.n, `${t.key} promises more presses than there are keys`);
    ok(t.label.length > 0, `${t.key} needs a name for the shelf`);
  }
  // Bands must not overlap, or the shelf's "harder" is a matter of board size alone.
  for (let i = 1; i < TIERS.length; i++) {
    ok(TIERS[i].par[0] > TIERS[i - 1].par[1], `bands overlap: ${TIERS.map((t) => t.par.join('-')).join(' ')}`);
  }
});

test('a seed and a band always give the same puzzle', () => {
  for (const t of TIERS) {
    const a = makePuzzle('seed-a', t.key);
    const b = makePuzzle('seed-a', t.key);
    eq(a, b, `${t.key} is not deterministic`);
    ok(a.ok, `seed-a in ${t.key} should ship something: ${JSON.stringify(a)}`);
  }
  // Count the boards that actually shipped: rejections have no board, and folding them into
  // the same tally would hide the band gate working.
  const seen = new Set();
  let shipped = 0;
  for (let s = 0; s < 160; s++) {
    const p = makePuzzle(`spread-${s}`, 'shadow');
    if (!p.ok) continue;
    shipped++;
    seen.add(p.board);
  }
  ok(shipped >= 60, `the band should accept a decent share of 160 seeds, got ${shipped}`);
  eq(seen.size, shipped, 'and no two accepted seeds produced the same board');
});

test('every shipped puzzle is solvable, in band, and its answer is the answer', () => {
  for (const t of TIERS) {
    const solver = getSolver(t.n);
    let accepted = 0;
    for (let s = 0; s < 60 && accepted < 12; s++) {
      const p = makePuzzle(`verify-${t.key}-${s}`, t.key);
      if (!p.ok) {
        ok(REJECT_REASONS.includes(p.reason), `${t.key}: rejection reason ${p.reason} is not declared`);
        continue;
      }
      accepted++;
      const board = boardOf(p.board);
      ok(board > 0n, 'never ships the already-solved board');
      eq(p.tier, t.key);
      eq([p.rank, p.nullity], [RANK_TABLE[t.n].rank, RANK_TABLE[t.n].nullity], `${t.key} measured against a different rank table`);
      eq(p.lit, bitCount(board), 'the printed light count matches the board');
      ok(p.par >= t.par[0] && p.par <= t.par[1], `${t.key}: par ${p.par} outside the window ${t.par}`);
      ok(p.keys >= t.keys[0] && p.keys <= t.keys[1], `${t.key}: dialed ${p.keys} outside ${t.keys}`);
      ok(p.par <= p.keys, 'the dial is an upper bound: pressing fewer keys than dialed is the whole point of the window');
      eq(p.pattern.length, p.par, 'the answer set is exactly par long');
      eq(new Set(p.pattern).size, p.par, 'and has no key twice');
      eq(applyPattern(board, p.n, p.pattern), 0n, 'the answer clears the board');
      eq(solve(board, p.n).presses, p.par, 'and re-solving from the serialised board agrees');
      eq(solver.minPresses(board).ok, true, 'unsolvable boards never leave the factory');
    }
    ok(accepted >= 8, `${t.key} accepted only ${accepted} of 60 seeds — the band would starve the shelf`);
  }
});

test('the band gate rejects a dial that lands outside its window', () => {
  // 4x4 with the dial pinned at 8: measured pars there are 0, 2, 4 and 6 (see the 4x4
  // sweep), and the window demands 13..15, so nothing can pass. A generator that shipped
  // here is a generator that does not read its own measurement.
  const strict = { key: 'impossible', label: '试验', n: 4, keys: [8, 8], par: [13, 15] };
  const reasons = {};
  for (let s = 0; s < 80; s++) {
    const p = makePuzzle(`gate-${s}`, strict);
    eq(p.ok, false, `seed ${s} slipped through a window it cannot fit`);
    reasons[p.reason] = (reasons[p.reason] || 0) + 1;
  }
  eq(Object.keys(reasons).sort(), ['out_of_band'], 'the only way out of that window is the band check');
});

test('an empty rejection is impossible, and if it happens it is named', () => {
  // Pressing a whole quiet pattern would produce the all-dark board; the dial would have to
  // hit it exactly, and the reason string has to exist rather than fall through as ok.
  const wide = { key: 'eight', label: '试验', n: 4, keys: [8, 8], par: [0, 15] };
  let empties = 0;
  for (let s = 0; s < 400; s++) {
    const p = makePuzzle(`empty-${s}`, wide);
    if (!p.ok) {
      eq(p.reason, 'empty', 'the only rejection this window allows');
      eq(p.par, 0);
      empties++;
    }
  }
  ok(empties <= 4, `quiet patterns are rare: ${empties} of 400 is far above the expected rate`);
});

test('a tier may be given by key or by object, and unknown keys are refused', () => {
  eq(tierByKey('faint').n, 4);
  eq(tierByKey(TIERS[2]).key, 'shadow');
  let threw = '';
  try {
    tierByKey('no-such-tier');
  } catch (err) {
    threw = String(err.message);
  }
  ok(/unknown tier/.test(threw), `unknown tier must be an error, got ${threw}`);
});

test('makePuzzle never writes into the tier it was given', () => {
  for (const t of TIERS) {
    const before = JSON.stringify(t);
    makePuzzle('mutate-check', t);
    eq(JSON.stringify(t), before, `${t.key} was modified`);
  }
  const obj = { key: 'ghost', label: '试验', n: 4, keys: [3, 5], par: [1, 9] };
  const snapshot = JSON.stringify(obj);
  makePuzzle('mutate-check-2', obj);
  eq(JSON.stringify(obj), snapshot, 'and neither was a caller-owned tier');
});

test('the rejection vocabulary is exactly the one bake.mjs prints', () => {
  eq(REJECT_REASONS, ['out_of_band', 'empty', 'duplicate', 'unsolvable']);
  eq(new Set(REJECT_REASONS).size, 4, 'no reason twice');
});

run();
