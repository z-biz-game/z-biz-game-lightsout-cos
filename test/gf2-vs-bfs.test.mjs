// The second leg: 4x4, all of it. Every one of the 2^16 boards is asked two independent
// questions — the GF(2) coset minimum, and the breadth-first distance in the press graph
// (which uses no linear algebra whatsoever) — and the two answers must agree everywhere,
// including on "unsolvable". This is the run whose numbers DESIGN.md quotes.
//
// 5x5 is not swept: 2^25 = 33.5M boards against a graph of 8.4M reachable states would be
// minutes and gigabytes for a check that adds no new kind of evidence. It is sampled
// instead (test/solve.test.mjs), and the reason is written down rather than hidden.

import { test, run, ok, eq } from '../tools/harness.mjs';
import { getSolver, verifyCertificate } from '../js/core/gf2.js';
import { bfsTable, bfsPresses } from '../js/core/solve.js';
import { flipMasks, applyPattern, bitCount, allLit } from '../js/core/grid.js';
import { RANK_TABLE, IMAGE_COUNT, PAIR_PRESS, QUIET } from './fixture.mjs';

const t0 = Date.now();
const table = bfsTable(4);
const solver = getSolver(4);
const sweepMs = Date.now() - t0;

test('the 4x4 press graph reaches exactly the published 4096 boards', () => {
  eq(table.image, IMAGE_COUNT[4], 'image of the toggle matrix = number of solvable boards');
  eq(table.image, 2 ** RANK_TABLE[4].rank, 'and that is 2^rank');
  eq(table.states, table.image, 'BFS enqueued every board it could reach and nothing else');
  eq(table.size, 65536, '4x4 has 2^16 boards in total');
});

test('the other 61440 boards are unsolvable, and both sides say so', () => {
  eq(table.size - table.image, 61440, '2^16 - 2^12, typed in from the rank fixture');
  let bothNo = 0;
  let onlyCosetSaysNo = 0;
  let onlyBfsSaysNo = 0;
  for (let m = 0; m < table.size; m++) {
    const unreachable = table.dist[m] < 0;
    const r = solver.minPresses(BigInt(m));
    if (unreachable && !r.ok) bothNo++;
    else if (unreachable) onlyCosetSaysNo++;
    else if (!r.ok) onlyBfsSaysNo++;
  }
  eq(bothNo, 61440, 'every unreachable board was also refused by the elimination');
  eq([onlyCosetSaysNo, onlyBfsSaysNo], [0, 0], 'and no board was refused by one side alone');
});

test('full sweep: coset minimum equals BFS distance on all 65536 boards', () => {
  let checked = 0;
  let mismatches = 0;
  const firstBad = [];
  for (let m = 0; m < table.size; m++) {
    const d = table.dist[m];
    const r = solver.minPresses(BigInt(m));
    checked++;
    if (d < 0) {
      if (r.ok) { mismatches++; if (firstBad.length < 3) firstBad.push({ m, want: 'unreachable', got: r.presses }); }
      continue;
    }
    if (!r.ok || r.presses !== d) {
      mismatches++;
      if (firstBad.length < 3) firstBad.push({ m, want: d, got: r.ok ? r.presses : 'unsolvable' });
    }
  }
  eq(checked, 65536, 'nothing was skipped');
  eq(mismatches, 0, `the algebra and the graph disagree ${mismatches} times: ${JSON.stringify(firstBad)}`);
  console.log(`  sweep: 65536 boards, image ${table.image}, diameter ${table.diameter}, mismatches 0 (${sweepMs}ms)`);
});

test('the sweep found no counterexample to any shipped par on 4x4', () => {
  let maxPar = 0;
  for (let m = 0; m < table.size; m++) if (table.dist[m] > maxPar) maxPar = table.dist[m];
  eq(maxPar, table.diameter, 'the diameter printed by the sweep is the largest distance');
  eq(table.diameter, 7, 'the hardest 4x4 board in the game needs seven presses');
  ok(maxPar <= 16, 'and no par exceeds the number of keys');
});

test('the distance histogram is the binomial triangle for as long as quiet patterns cannot reach', () => {
  // hist[d] counts boards whose minimum is d presses. With the lightest nonempty quiet
  // pattern at weight 8 (brute-forced below from js/core/grid.js alone), all press sets of
  // size <= 3 give distinct boards, so hist[1..3] must be C(16,1), C(16,2), C(16,3).
  eq(table.hist[0], 1, 'only the all-dark board clears itself in zero presses');
  eq(table.hist[1], 16, 'one press: the sixteen keys, all different boards');
  eq(table.hist[2], 120, 'two presses: C(16,2)');
  eq(table.hist[3], 560, 'three presses: C(16,3)');
  let sum = 0;
  for (const v of table.hist) sum += v === undefined ? 0 : v;
  eq(sum, IMAGE_COUNT[4], 'every solvable board is counted once');
});

test('quiet patterns, brute-forced from the flip masks with no linear algebra at all', () => {
  const cols = flipMasks(4);
  const seen = [];
  for (let m = 0; m < 65536; m++) {
    let x = 0n;
    let w = 0;
    for (let j = 0; j < 16; j++) if ((m >> j) & 1) { x ^= cols[j]; w++; }
    if (x === 0n) seen.push(w);
  }
  eq(seen.length, QUIET.total, 'exactly 16 press sets change nothing');
  eq(seen.length, 2 ** RANK_TABLE[4].nullity, 'which is 2^nullity');
  eq(seen.filter((w) => w > 0).length, QUIET.nonzero, 'fifteen of them are nonempty');
  eq(Math.min(...seen.filter((w) => w > 0)), QUIET.minWeight, 'and the lightest weighs eight');
  eq(new Set(seen).size, 3, 'the weights are 0, 8 and 12 only');
});

test('every two-key board on 4x4 has par exactly 2', () => {
  eq([PAIR_PRESS.n, PAIR_PRESS.pairs], [4, 120]);
  const cols = flipMasks(4);
  let pairs = 0;
  for (let i = 0; i < 16; i++) {
    for (let j = i + 1; j < 16; j++) {
      const board = cols[i] ^ cols[j];
      const r = solver.minPresses(board);
      eq(r.presses, PAIR_PRESS.par, `keys ${i}+${j}`);
      eq(table.dist[Number(board)], PAIR_PRESS.par, `keys ${i}+${j} against the graph`);
      pairs++;
    }
  }
  eq(pairs, 120, 'and that was all of them');
});

test('bfsPresses is the bounded version of the same question and agrees', () => {
  for (const board of [allLit(4), 0n, 1n, 4095n, 65535n]) {
    const one = bfsPresses(4, board, { limit: 20000 });
    const coset = solver.minPresses(board);
    if (board === 0n) {
      eq([one.ok, one.presses], [true, 0], 'the all-dark board is solved before the walk starts');
      continue;
    }
    eq(one.ok, coset.ok, `${board}: reachable agrees with solvable`);
    if (coset.ok) eq(one.presses, coset.presses, `${board}: distance agrees with par`);
    eq(one.truncated, false, 'and the budget was never the reason');
  }
  const tiny = bfsPresses(4, allLit(4), { limit: 2 });
  eq([tiny.ok, tiny.truncated], [false, true], 'a starved budget reports that it does not know');
});

test('the 5x5 graph is too big to sweep, and the code says so instead of hanging', () => {
  let threw = null;
  try {
    bfsTable(5);
  } catch (err) {
    threw = String(err.message);
  }
  ok(threw && /full sweep|out of the question/.test(threw), `bfsTable(5) must refuse loudly, got ${threw}`);
  ok(/2\^25/.test(threw || ''), 'and name the size it refused');
});

test('a certificate from the sweep is a quiet pattern that overlaps the board oddly', () => {
  // Take the first 200 unreachable boards by BFS and check each witness against the flip
  // masks directly — no reuse of the elimination that produced it.
  const cols = flipMasks(4);
  let checked = 0;
  for (let m = 1; m < table.size && checked < 200; m++) {
    if (table.dist[m] >= 0) continue;
    checked++;
    const r = solver.minPresses(BigInt(m));
    ok(!r.ok && r.certificate > 0n, `board ${m} must come with a witness`);
    eq(applyPattern(0n, 4, Array.from({ length: 16 }, (_, j) => j).filter((j) => (r.certificate >> BigInt(j)) & 1n)), 0n,
      `board ${m}: the witness flips nothing`);
    eq(bitCount(r.certificate & BigInt(m)) % 2, 1, `board ${m}: the witness overlaps the board oddly`);
    eq(verifyCertificate(4, BigInt(m), r.certificate), { killsMatrix: true, parity: 1 });
  }
  eq(checked, 200, 'and the loop really did walk 200 of them');
});

run();
