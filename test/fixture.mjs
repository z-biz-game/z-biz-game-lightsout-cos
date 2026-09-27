// Fixtures whose expected numbers were typed in before the code under test was run, from
// the published anchor table (2026-09-27, /tmp/puzzle-brief/probe2.mjs, probe3.mjs,
// probe4.mjs) and from the two hand derivations written out below. Nothing in this file is
// computed by js/core, and no test may replace a value here with "whatever the code said".

// rank / nullity of the cross-neighbourhood toggle matrix, per board size. Published.
export const RANK_TABLE = {
  3: { rank: 9, nullity: 0 },
  4: { rank: 12, nullity: 4 },
  5: { rank: 23, nullity: 2 },
  6: { rank: 36, nullity: 0 },
  7: { rank: 49, nullity: 0 },
};

// |image(M)| = 2^rank. 4x4 is the one that can be enumerated exhaustively, and it must come
// out 4096: three quarters of the 2^16 boards are not solvable at all.
export const IMAGE_COUNT = { 4: 4096 };

export const SOLVABLE_FRACTION = { 4: 4, 5: 4 }; // "one board in 2^nullity is solvable"

// Boards with a par that was derived by hand, not measured by the code under test.
export const HAND = [
  {
    name: '3x3 all lit',
    n: 3,
    board: '511', // 2^9 - 1
    par: 5,
    pattern: [0, 2, 4, 6, 8],
    // Why 5: the four corners plus the centre flip every cell exactly once (a corner flips
    // only itself and two edge cells; the centre flips itself and the four edge cells, so
    // each edge cell is flipped by the centre plus its two adjacent corners = 3 = odd).
    // nullity is 0, so the solution is unique and its weight IS the minimum.
    reason: 'unique solution because nullity is 0',
  },
  {
    name: '4x4 all lit',
    n: 4,
    board: '65535',
    par: 4,
    pattern: [2, 4, 11, 13],
    // Why 4 and not 3: keys 2,4,11,13 flip {1,2,3,6},{0,4,5,8},{7,10,11,15},{9,12,13,14} —
    // sixteen cells, each hit once, so the all-lit board dies in 4. Three presses flip at
    // most 3*5 = 15 cells, which cannot cover 16, so 3 is impossible.
    reason: 'upper bound by the pattern above, lower bound because 3 presses flip <= 15 cells',
  },
  {
    name: '5x5 all lit',
    n: 5,
    board: '33554431',
    par: 15,
    pattern: [1, 2, 4, 6, 7, 8, 12, 13, 14, 15, 16, 18, 19, 20, 21],
    // Published: the optimum for the all-lit 5x5 board is 15 presses (probe2.mjs, and the
    // classic Lights Out result). The pattern is checked against js/core/grid.js only.
    reason: 'published optimum',
  },
];

// One-press boards. The board a single press makes must clear in exactly one press:
// one is an upper bound by construction and the board is not all-dark, so it is the minimum.
export const SINGLE_PRESS = (n) => ({ count: n * n, par: 1 });

// Two-press boards on 4x4: every pair of distinct keys gives a board whose par is exactly 2,
// because two different press sets produce the same board iff their symmetric difference is a
// quiet pattern, and the lightest nonempty quiet pattern on 4x4 has weight 8 (brute-forced
// from js/core/grid.js in test/gf2-vs-bfs.test.mjs — 8 > 2+1 rules out par 1 and par 0).
export const PAIR_PRESS = { n: 4, pairs: 120, par: 2 };

// Boards that are provably not solvable. On 4x4 no single-lit board is solvable; on 5x5 a
// single corner is not. Each claim is backed by a certificate the test verifies.
export const UNSOLVABLE = [
  { name: '4x4 has no solvable single-cell board', n: 4, everyCell: 16 },
  { name: '5x5 single corner', n: 5, board: '1' },
];

// The quiet patterns (nonempty press sets that change nothing) measured on 4x4 by brute
// force over all 2^16 subsets of keys using only js/core/grid.js.
export const QUIET = { n: 4, total: 16, nonzero: 15, minWeight: 8 };
