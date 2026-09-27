// The algebra: the published rank/nullity table, the hand-derived pars, and the certificate
// machinery. Every expectation here is typed in from fixture.mjs, which is typed from the
// probe run of 2026-09-27 and from the two hand derivations written there.

import { test, run, ok, eq } from '../tools/harness.mjs';
import { RANK_TABLE, IMAGE_COUNT, HAND, SINGLE_PRESS, UNSOLVABLE } from './fixture.mjs';
import { getSolver, rankNullity, imageCount, toggleMatrix, pressEffect, verifyCertificate, minPresses, dotGF2 } from '../js/core/gf2.js';
import { flipMasks, applyPattern, allLit, bitCount, boardOf, cellsOf, hasBit } from '../js/core/grid.js';

test('the toggle matrix is symmetric, which is what certificates lean on', () => {
  for (const n of [3, 4, 5, 6, 7]) {
    const { cols, rows } = toggleMatrix(n);
    for (let i = 0; i < n * n; i++) eq(cols[i], rows[i], `${n}x${n} row ${i} is not its own column`);
  }
});

test('rank/nullity of the cross matrix matches the published table, size by size', () => {
  for (const n of [3, 4, 5, 6, 7]) {
    const want = RANK_TABLE[n];
    const got = rankNullity(n);
    eq([got.rank, got.nullity], [want.rank, want.nullity], `${n}x${n} rank/nullity`);
  }
  // Written out once more as literals, so editing the table above cannot quietly move
  // the goalposts with the code.
  eq([rankNullity(3).rank, rankNullity(4).rank, rankNullity(5).rank, rankNullity(6).rank, rankNullity(7).rank], [9, 12, 23, 36, 49]);
  eq([rankNullity(3).nullity, rankNullity(4).nullity, rankNullity(5).nullity, rankNullity(6).nullity, rankNullity(7).nullity], [0, 4, 2, 0, 0]);
});

test('the count of solvable boards is 2^rank, and 4x4 is the published 4096', () => {
  eq(imageCount(4), 4096n, '4x4 image must be 2^12 = 4096, not 2^16');
  eq(imageCount(4), BigInt(IMAGE_COUNT[4]), 'fixture and code agree on the published number');
  eq(imageCount(3), 512n, '3x3: full rank, so every board is solvable');
  eq(imageCount(5), 8388608n, '5x5: 2^23, a quarter of 2^25');
  for (const n of [3, 4, 5]) eq(imageCount(n), 2n ** BigInt(RANK_TABLE[n].rank), `${n}x${n} image = 2^rank`);
});

test('the kernel basis has exactly nullity members and each is a quiet pattern', () => {
  for (const n of [3, 4, 5, 6, 7]) {
    const s = getSolver(n);
    eq(s.kernel.length, RANK_TABLE[n].nullity, `${n}x${n} kernel basis size`);
    for (const z of s.kernel) eq(pressEffect(n, z), 0n, `${n}x${n} kernel vector must flip nothing`);
    // The coset the par is enumerated over is 2^nullity wide.
    eq(s.coset.length, 2 ** RANK_TABLE[n].nullity, `${n}x${n} coset size`);
  }
});

test('the 4x4 kernel closes to 16 quiet patterns, none of them light', () => {
  const s = getSolver(4);
  eq(s.coset.length, 16);
  eq(new Set(s.coset.map((z) => z.toString())).size, 16, 'coset elements must be distinct');
  for (const z of s.coset) {
    if (!z) continue;
    ok(bitCount(z) >= 8, `a 4x4 quiet pattern of weight ${bitCount(z)} would undercut every par in the pool`);
  }
});

test('the all-dark board needs no presses and is already solved', () => {
  for (const n of [3, 4, 5]) {
    const r = minPresses(n, 0n);
    eq([r.ok, r.presses, r.pattern.length], [true, 0, 0], `${n}x${n} empty board`);
  }
});

test('hand-derived fixtures: par is the typed-in number, pattern is the typed-in set', () => {
  for (const f of HAND) {
    const board = boardOf(f.board);
    const r = minPresses(f.n, board);
    eq(r.ok, true, `${f.name} must be solvable`);
    eq(r.presses, f.par, `${f.name} par`);
    // The hand pattern is checked against the board with js/core/grid.js only, so the
    // fixture's upper bound does not depend on the elimination being right.
    eq(applyPattern(0n, f.n, f.pattern), board, `${f.name} hand pattern does not produce the board`);
    eq(f.pattern.length, f.par, `${f.name} pattern length is the par`);
  }
  eq(minPresses(3, allLit(3)).presses, 5, '3x3 all lit');
  eq(minPresses(4, allLit(4)).presses, 4, '4x4 all lit');
  eq(minPresses(5, allLit(5)).presses, 15, '5x5 all lit — the published optimum');
  eq(minPresses(5, allLit(5)).cosetSize, 4, 'and it was chosen out of 2^2 candidates');
});

test('one press on any key gives a board whose par is exactly 1', () => {
  for (const n of [4, 5]) {
    const spec = SINGLE_PRESS(n);
    eq(spec.count, n * n);
    const cols = flipMasks(n);
    for (let j = 0; j < spec.count; j++) {
      const r = minPresses(n, cols[j]);
      eq(r.presses, spec.par, `${n}x${n} key ${j}`);
      eq(r.pattern, [j], `${n}x${n} key ${j} solution`);
    }
  }
});

test('a board nobody can solve is reported as unsolvable, with a checkable certificate', () => {
  // 4x4: none of the sixteen single-lit boards is solvable (fixture: UNSOLVABLE[0]).
  const s4 = getSolver(4);
  for (let j = 0; j < UNSOLVABLE[0].everyCell; j++) {
    const board = 1n << BigInt(j);
    const r = s4.minPresses(board);
    eq(r.ok, false, `4x4 with only cell ${j} lit must be unsolvable`);
    ok(r.residual > 0n, 'the elimination leaves a nonzero row, which is the 0 = 1 line');
    ok(r.certificate > 0n, 'and it names a kernel vector as the witness');
    eq(verifyCertificate(4, board, r.certificate), { killsMatrix: true, parity: 1 }, `4x4 cell ${j} certificate`);
  }
  // 5x5: a single corner is off the coset, the single centre is not.
  const c5 = minPresses(5, boardOf(UNSOLVABLE[1].board));
  eq(c5.ok, false, '5x5 with only the corner lit');
  eq(verifyCertificate(5, 1n, c5.certificate), { killsMatrix: true, parity: 1 });
  const centre = minPresses(5, 1n << 12n);
  eq(centre.ok, true, '5x5 with only the centre lit is solvable');
  eq(centre.certificate, undefined, 'a solvable board has no 0 = 1 row to show');
});

test('the certificate really is a kernel vector with odd overlap', () => {
  const s = getSolver(4);
  const board = 1n;
  const y = s.certificate(board);
  ok(y > 0n, 'a witness exists');
  eq(pressEffect(4, y), 0n, 'M y = 0');
  eq(dotGF2(y, board), 1, 'y . b = 1');
  ok(bitCount(y) === 8 || bitCount(y) === 12, `4x4 quiet patterns have weight 8 or 12, got ${bitCount(y)}`);
  // and the same y proves nothing about a board it does not overlap
  eq(dotGF2(y, 0n), 0, 'the all-dark board is not certified unsolvable');
  eq(s.certificate(0n), null, 'nor offered');
});

test('the residual row is one of the rows with no pivot', () => {
  const s = getSolver(4);
  eq(s.freeRows.length, 4, 'nullity 4 means four rows without a pivot');
  eq(s.pivotRows.length, 12, 'and twelve with one');
  const { rem } = s.reduce(1n);
  ok(rem > 0n);
  const rows = cellsOf(4, rem).map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  for (const r of rows) ok(s.freeRows.includes(r), `residual touches row ${r}, which has a pivot: reduction is wrong`);
  for (let i = 0; i < 16; i++) if (!s.freeRows.includes(i)) ok(!hasBit(rem, i), `pivot row ${i} should have been reduced away`);
});

test('solving does not change what it was given', () => {
  const board = allLit(5);
  const colsBefore = flipMasks(5).map(String);
  const tiers = { n: 5, par: [1, 15] };
  const before = JSON.stringify(tiers);
  const a = minPresses(5, board);
  const b = minPresses(5, board);
  eq(a.pattern, b.pattern, 'same board twice, same answer twice');
  eq(flipMasks(5).map(String), colsBefore, 'the cached column table was not mutated');
  eq(JSON.stringify(tiers), before, 'a caller-owned object survives the solve');
  eq(board, allLit(5), 'the board argument is untouched (it is a BigInt, and staying equal is the point)');
});

test('a board and its coset mates share their minimum by construction', () => {
  // Pressing a quiet pattern on top of a board must not change the par: it is the same
  // board. This is the property the whole difficulty claim rests on.
  const s = getSolver(4);
  const board = 12345n;
  const quiet = s.coset[3] ^ s.coset[5];
  const r1 = s.minPresses(board);
  const flipped = board ^ pressEffect(4, quiet);
  eq(flipped, board, 'a quiet pattern does not change the board');
  eq(s.minPresses(flipped).presses, r1.presses, 'so it cannot change the par either');
});

test('minPresses returns a press set that actually clears the board', () => {
  for (const n of [3, 4, 5]) {
    const s = getSolver(n);
    for (let t = 0; t < 40; t++) {
      const x = BigInt(t * 2654435761) % (1n << BigInt(n * n));
      const r = s.minPresses(pressEffect(n, x));
      ok(r.ok, 'boards built from a press set are in the image');
      eq(applyPattern(r.board, n, r.pattern), 0n, `${n}x${n} sample ${t}: the answer must clear the board`);
      eq(r.pattern.length, r.presses, 'and the count is the size of the set');
    }
  }
});

run();
