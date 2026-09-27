// The board representation. Nothing here searches or solves; it is the vocabulary the rest
// of the repo speaks, so its invariants (press = XOR, presses commute, masks round-trip)
// are pinned before any algebra is trusted.

import { test, run, ok, eq } from '../tools/harness.mjs';
import {
  neighbours, flipMask, flipMasks, applyPress, applyPattern, patternMask, maskPattern,
  bitCount, highestBit, hasBit, cellsOf, boardFromCells, boardToNumber, boardOf, allLit,
  isSolved, litCount, keyDegrees, validSize, cellCount, MIN_N, MAX_N,
} from '../js/core/grid.js';
import { mulberry32, hashSeed } from '../js/core/rng.js';

test('the cross neighbourhood is what the rules say it is', () => {
  // 4x4, typed by hand. Key 0 is the top-left corner: itself, right, below.
  eq(neighbours(4, 0), [0, 1, 4], 'corner key');
  eq(neighbours(4, 1), [1, 0, 2, 5], 'top edge key');
  eq(neighbours(4, 6), [6, 2, 5, 7, 10], 'interior key: self first, then the neighbourhood in reading order');
  eq(neighbours(4, 15), [15, 11, 14], 'bottom-right corner');
  eq(neighbours(3, 4), [4, 1, 3, 5, 7], 'the centre of a 3x3');
  eq(neighbours(5, 12).length, 5, 'the centre of a 5x5 has five cells');
});

test('key degrees: 3 at the corners, 4 on the edges, 5 in the field', () => {
  eq(keyDegrees(3), [3, 4, 3, 4, 5, 4, 3, 4, 3], '3x3 degrees, written out by hand');
  eq(keyDegrees(4), [3, 4, 4, 3, 4, 5, 5, 4, 4, 5, 5, 4, 3, 4, 4, 3], '4x4 degrees');
  eq(keyDegrees(5).filter((d) => d === 3).length, 4, 'four corners');
  eq(keyDegrees(5).filter((d) => d === 5).length, 9, 'a 3x3 field of interior keys');
  eq(keyDegrees(5).filter((d) => d === 4).length, 12, 'and the rest are edges');
});

test('flipMask is the neighbourhood as a mask, and it is symmetric', () => {
  eq(flipMask(4, 0), 0b10011n, 'corner key 0 flips cells 0, 1 and 4');
  for (const n of [3, 4, 5]) {
    for (let j = 0; j < n * n; j++) {
      for (const i of neighbours(n, j)) ok(hasBit(flipMask(n, j), i), `${n}: ${j} should flip ${i}`);
      eq(bitCount(flipMask(n, j)), neighbours(n, j).length, `${n}: ${j} flips exactly its neighbourhood`);
    }
  }
  // Symmetry of the rule: j flips i exactly when i flips j.
  for (const n of [4, 5]) {
    for (let i = 0; i < n * n; i++) {
      for (let j = 0; j < n * n; j++) eq(hasBit(flipMask(n, i), j), hasBit(flipMask(n, j), i), `${n}: ${i}/${j}`);
    }
  }
});

test('pressing a key twice is the identity, in both directions', () => {
  const rng = mulberry32(hashSeed('involution'));
  for (const n of [3, 4, 5]) {
    for (let t = 0; t < 60; t++) {
      const board = BigInt(rng.int(1 << Math.min(30, n * n)));
      for (let j = 0; j < n * n; j++) {
        eq(applyPress(applyPress(board, n, j), n, j), board, `${n}x${n} key ${j}`);
      }
    }
  }
});

test('presses commute, so only the set matters — this is the par argument in miniature', () => {
  const rng = mulberry32(hashSeed('commute'));
  for (const n of [4, 5]) {
    for (let t = 0; t < 200; t++) {
      const board = BigInt(rng.int(1 << n * n));
      const a = rng.int(n * n);
      const b = rng.int(n * n);
      eq(applyPattern(board, n, [a, b]), applyPattern(board, n, [b, a]), `${n}x${n} ${a}/${b}`);
    }
  }
  // and a whole set in any order
  const set = [0, 5, 11, 17, 22].filter((j) => j < 25);
  const p = applyPattern(allLit(5), 5, set);
  eq(p, applyPattern(allLit(5), 5, [...set].reverse()), 'reversed order, same board');
});

test('applying every key on a board flips each cell by the parity of its degree', () => {
  // 4x4: corner cells are touched by 3 keys, edge cells by 4, interior cells by 5. Pressing all
  // 16 keys therefore lights exactly the four corners and the four interior cells — the odd ones.
  const all = Array.from({ length: 16 }, (_, j) => j);
  const board = applyPattern(0n, 4, all);
  eq(cellsOf(4, board), [
    1, 0, 0, 1,
    0, 1, 1, 0,
    0, 1, 1, 0,
    1, 0, 0, 1,
  ], 'the parity argument, painted');
  eq(litCount(4, board), 8, 'four corners plus four interior cells');
});

test('mask <-> pattern <-> cells round-trips', () => {
  const rng = mulberry32(hashSeed('roundtrip'));
  for (const n of [4, 5]) {
    for (let t = 0; t < 50; t++) {
      const board = BigInt(rng.int(1 << n * n));
      const cells = cellsOf(n, board);
      eq(cells.length, cellCount(n));
      eq(boardFromCells(cells), board, 'cells back to board');
      const mask = patternMask(n, cells.map((v, i) => (v ? i : -1)).filter((i) => i >= 0));
      eq(maskPattern(n, mask).length, bitCount(board), 'and the same count through the other door');
      eq(boardToNumber(board), board.toString(), 'serialised form');
      eq(boardOf(boardToNumber(board)), board, 'and back');
    }
  }
  eq(boardOf('33554431'), allLit(5), 'a 5x5 all-lit board survives the decimal string');
  eq(boardOf(0n), 0n);
  eq(typeof boardOf('12345'), 'bigint', 'the working form is always BigInt');
});

test('bit helpers do the arithmetic they claim', () => {
  eq(bitCount(0n), 0);
  eq(bitCount(1n), 1);
  eq(bitCount(0b1011n), 3, 'three bits set');
  eq(bitCount(allLit(5)), 25);
  eq(bitCount(allLit(4)), 16);
  eq(highestBit(0n), -1, 'zero has no top bit');
  eq(highestBit(1n), 0);
  eq(highestBit(255n), 7);
  eq(highestBit(allLit(5)), 24);
  eq(hasBit(8n, 3), true);
  eq(hasBit(8n, 2), false);
});

test('the board vocabulary knows what it is not', () => {
  eq(isSolved(0n), true);
  eq(isSolved(1n), false);
  eq(cellCount(5), 25);
  eq([MIN_N, MAX_N], [3, 7]);
  eq([validSize(2), validSize(3), validSize(5), validSize(7), validSize(8), validSize(4.5), validSize('4')],
    [false, true, true, true, false, false, false], 'only whole sizes 3..7 are in the measured rank table');
});

test('pressing an off-board key is refused, not wrapped', () => {
  for (const bad of [-1, 16, 1.5, '3', null, undefined, NaN]) {
    let threw = false;
    try {
      applyPress(0n, 4, bad);
    } catch (err) {
      threw = /off the/.test(String(err.message));
    }
    ok(threw, `applyPress(${String(bad)}) must complain loudly`);
  }
});

test('flipMasks is a cached table, not a rebuild, and nobody can edit it by accident', () => {
  eq(flipMasks(4), flipMasks(4), 'same array for the same size');
  eq(flipMasks(4).length, 16);
  const before = flipMasks(4).map(String).join(',');
  applyPattern(0n, 4, [0, 1, 2]);
  eq(flipMasks(4).map(String).join(','), before, 'playing did not rewrite the table');
});

run();
