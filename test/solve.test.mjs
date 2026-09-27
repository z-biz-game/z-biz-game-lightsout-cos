// The solver's public face: what solve() promises, that its answer really clears the board,
// that the answer is the *lightest* one, and that solving a position mid-game works.

import { test, run, ok, eq } from '../tools/harness.mjs';
import { HAND, RANK_TABLE } from './fixture.mjs';
import { solve, isSolvable, bfsTable, bfsPresses, patternCells } from '../js/core/solve.js';
import { getSolver, pressEffect } from '../js/core/gf2.js';
import { applyPattern, boardOf, allLit, flipMasks, bitCount } from '../js/core/grid.js';
import { mulberry32, hashSeed } from '../js/core/rng.js';

test('solve() reports the shape the shell depends on', () => {
  const r = solve(allLit(5), 5);
  eq(r.ok, true);
  eq(r.presses, 15, 'the published optimum for the all-lit 5x5');
  eq(r.pattern.length, 15);
  eq(r.cosetSize, 4, '2^nullity candidates were weighed');
  eq(r.examined, 4, 'and all of them were looked at');
  eq([r.rank, r.nullity], [RANK_TABLE[5].rank, RANK_TABLE[5].nullity]);
  eq(typeof r.board, 'bigint', 'the board comes back in the working form');
});

test('every hand fixture solves to the typed-in par and the replay clears the board', () => {
  for (const f of HAND) {
    const r = solve(boardOf(f.board), f.n);
    eq(r.presses, f.par, f.name);
    eq(applyPattern(boardOf(f.board), f.n, r.pattern), 0n, `${f.name}: the answer must actually work`);
    eq(r.pattern.length, f.par, `${f.name}: whatever set it names, it is a shortest one`);
  }
});

test('no lighter press set exists — 3x3 exhaustively, with no algebra at all', () => {
  // 3x3 has 512 press sets; enumerate them straight off the flip masks and take the
  // lightest that produces the all-lit board. This is the "穷举反证不存在更短解" leg.
  const cols = flipMasks(3);
  let best = 99;
  let hits = 0;
  for (let m = 0; m < 512; m++) {
    let x = 0n;
    let w = 0;
    for (let j = 0; j < 9; j++) if ((m >> j) & 1) { x ^= cols[j]; w++; }
    if (x === allLit(3)) { hits++; if (w < best) best = w; }
  }
  eq(best, 5, 'nothing shorter than five presses lights the whole 3x3');
  eq(hits, 1, 'nullity 0 means exactly one press set does it');
  eq(solve(allLit(3), 3).presses, best, 'and the coset enumeration agrees');
});

test('the 5x5 coset is provably complete: four distinct quiet patterns, no more', () => {
  const s = getSolver(5);
  eq(s.coset.length, 4, '2^nullity with nullity 2');
  eq(new Set(s.coset.map(String)).size, 4, 'all distinct');
  for (const z of s.coset) eq(pressEffect(5, z), 0n, 'every coset member flips nothing');
  // So the four candidates solve() weighed are all the solutions there are.
  const r = s.minPresses(allLit(5));
  const weights = s.coset.map((z) => bitCount(r.mask ^ z)).sort((a, b) => a - b);
  eq(weights[0], r.presses, 'the minimum over the four is what it returned');
  eq(Math.min(...weights), 15, 'and that minimum is the published number');
});

test('isSolvable agrees with solve, including on the boards that are not', () => {
  eq(isSolvable(1n, 4), false, 'a single lit corner on 4x4');
  eq(isSolvable(allLit(4), 4), true);
  eq(isSolvable(0n, 4), true);
  eq(isSolvable(1n, 5), false);
  eq(isSolvable(1n, 3), true, '3x3 has full rank, so every board is solvable');
  const tab = bfsTable(3);
  eq(tab.image, 512, 'and the graph reaches all of them');
  for (let m = 0; m < 512; m++) eq(isSolvable(BigInt(m), 3), tab.dist[m] >= 0, `3x3 board ${m}`);
});

test('a board partway through a game is a legitimate thing to solve from', () => {
  const start = allLit(5);
  const r0 = solve(start, 5);
  const first = r0.pattern[0];
  const mid = applyPressSafe(start, first);
  const r1 = solve(mid, 5);
  ok(r1.presses <= r0.presses - 1, 'the rest of the optimal set still solves it, so at most par-1 presses remain');
  eq(applyPattern(mid, 5, r1.pattern), 0n, 'and the remaining answer works from where the player stands');
  function applyPressSafe(board, j) {
    return applyPattern(board, 5, [j]);
  }
});

test('solve is a function of its arguments: same input, same output, no side effects', () => {
  const rng = mulberry32(hashSeed('purity'));
  const boards = Array.from({ length: 25 }, () => BigInt(rng.int(1 << 25)));
  for (const b of boards) {
    const a = solve(b, 5);
    const c = solve(b, 5);
    eq(a, c, 'deterministic down to the tie-break');
    eq(a.pattern, c.pattern, 'the same set, in the same order');
  }
  const opts = { limit: 999 };
  const before = JSON.stringify(opts);
  bfsPresses(4, allLit(4), opts);
  eq(JSON.stringify(opts), before, 'bfsPresses does not write into the options it was handed');
});

test('patternCells labels a solution in 1-based board coordinates', () => {
  eq(patternCells(4, [0, 15]), [{ r: 1, c: 1 }, { r: 4, c: 4 }], 'the two opposite corners');
  eq(patternCells(5, [12]), [{ r: 3, c: 3 }], 'the centre key');
  eq(patternCells(4, []), [], 'an empty set is an empty list');
  eq(patternCells(4, [5]), [{ r: 2, c: 2 }]);
});

test('a sampled 5x5 sweep matches the bounded graph walk wherever the walk can get there', () => {
  const s = getSolver(5);
  const rng = mulberry32(hashSeed('sample5'));
  const cols = flipMasks(5);
  let compared = 0;
  for (let t = 0; t < 12; t++) {
    const k = 2 + t;
    const set = new Set();
    while (set.size < k) set.add(rng.int(25));
    let board = 0n;
    for (const j of set) board ^= cols[j];
    const coset = s.minPresses(board);
    const walked = bfsPresses(5, board, { limit: 30000 });
    ok(coset.ok, 'a board built from presses is solvable');
    if (walked.truncated) {
      ok(walked.states > 30000, 'it says it does not know, and shows the budget it burned');
      continue;
    }
    eq(walked.presses, coset.presses, `5x5 sample ${t}`);
    compared++;
  }
  ok(compared > 0, `at least one 5x5 board was small enough for both methods (got ${compared})`);
});

test('pressing a quiet pattern never changes the par of anything', () => {
  const s = getSolver(5);
  const quiet = s.kernel[0];
  const rng = mulberry32(hashSeed('quiet5'));
  const cols = flipMasks(5);
  for (let t = 0; t < 20; t++) {
    const set = new Set();
    while (set.size < 6) set.add(rng.int(25));
    let board = 0n;
    for (const j of set) board ^= cols[j];
    eq(s.minPresses(board ^ pressEffect(5, quiet)).presses, s.minPresses(board).presses, `sample ${t}`);
  }
});

run();
