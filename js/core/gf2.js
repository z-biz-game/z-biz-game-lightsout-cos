// GF(2) linear algebra: this file is where "最少按几次" is actually decided.
//
// The board is a vector b in F2^(n*n). Pressing key j adds (XOR) column j of the toggle
// matrix M, so pressing a *set* S of keys lands on the board M*x(S), where x(S) is the
// 0/1 indicator vector of S. Two consequences drive the whole design:
//
//   * x and x' give the same board iff x - x' is in ker(M), so the solutions of M*x = b
//     form one coset of the kernel — exactly 2^nullity candidates, no more, no less;
//   * therefore the minimum number of presses is min weight(x) over that coset, which is
//     enumerated here in full. It is not a heuristic and not a bound: it is the minimum.
//
// nullity is 4 for 4x4 and 2 for 5x5, so a coset holds 16 or 4 vectors: the search that
// "cannot be done at tap time" is trivial *because* the algebra replaces search. The only
// exhaustive state-space search lives in tools/bake.mjs and test/gf2-vs-bfs.test.mjs.
//
// M is symmetric (the cross neighbourhood is), which is what lets an unsolvable board be
// certified: b is off the column space iff some kernel vector y has odd overlap with b,
// i.e. the row y^T*M = 0 reads `0 = 1` against b. getSolver() throws if symmetry ever
// breaks, because the certificate below silently stops being one if it does.

import {
  flipMasks, cellCount, bitCount, highestBit, hasBit, maskPattern, validSize,
} from './grid.js';

// rows[i] is built by transposing cols, so `rows[i] === cols[i]` is a real test of the
// neighbourhood rule rather than a restatement of it.
export function toggleMatrix(n) {
  const size = cellCount(n);
  const cols = flipMasks(n);
  const rows = new Array(size);
  for (let i = 0; i < size; i++) {
    let m = 0n;
    for (let j = 0; j < size; j++) if (hasBit(cols[j], i)) m |= 1n << BigInt(j);
    rows[i] = m;
  }
  return { n, size, cols, rows };
}

// XOR of the columns selected by a press mask: the board a press set produces from all-dark.
export function pressEffect(n, pressMask) {
  const cols = flipMasks(n);
  let m = 0n;
  for (const j of maskPattern(n, pressMask)) m ^= cols[j];
  return m;
}

export function dotGF2(a, b) {
  return bitCount(a & b) % 2;
}

const solvers = new Map();

export function getSolver(n) {
  const hit = solvers.get(n);
  if (hit) return hit;
  if (!validSize(n)) throw new Error(`board size ${n} is outside the measured rank table (${3}..${7})`);
  const { size, cols, rows } = toggleMatrix(n);
  for (let i = 0; i < size; i++) {
    if (cols[i] !== rows[i]) throw new Error(`toggle matrix for ${n}x${n} is not symmetric at row ${i}`);
  }

  const pivots = new Map(); // leading cell index -> { vec, comb } with vec === M*comb
  const kernel = [];        // basis of ker(M), as press-space masks
  for (let j = 0; j < size; j++) {
    let rem = cols[j];
    let comb = 0n;
    let fresh = false;
    while (rem) {
      const k = highestBit(rem);
      const p = pivots.get(k);
      if (!p) { fresh = true; break; }
      rem ^= p.vec;
      comb ^= p.comb;
    }
    const withSelf = comb ^ (1n << BigInt(j));
    if (fresh) pivots.set(highestBit(rem), { vec: rem, comb: withSelf });
    else if (withSelf) kernel.push(withSelf);
  }

  // Every element of the coset, precomputed: 2^nullity masks, in a fixed order.
  const coset = new Array(1 << kernel.length);
  coset[0] = 0n;
  for (let m = 1; m < coset.length; m++) {
    const k = highestBitOfInt(m);
    coset[m] = coset[m ^ (1 << k)] ^ kernel[k];
  }

  const pivotRows = [...pivots.keys()].sort((a, b) => a - b);
  const covered = new Array(size).fill(false);
  for (const k of pivotRows) covered[k] = true;
  // The rows with no pivot are the `0 = *` rows of the echelon form: exactly the slots a
  // board's residual has to be zero in to be solvable.
  const freeRows = [];
  for (let i = 0; i < size; i++) if (!covered[i]) freeRows.push(i);

  const api = {
    n,
    size,
    rank: pivots.size,
    nullity: size - pivots.size,
    kernel,
    coset,
    pivotRows,
    freeRows,

    // Echelon reduction of a board. Invariant: rem === board ^ M*comb.
    reduce(board) {
      let rem = board;
      let comb = 0n;
      while (rem) {
        const k = highestBit(rem);
        const p = pivots.get(k);
        if (!p) break;
        rem ^= p.vec;
        comb ^= p.comb;
      }
      return { rem, comb };
    },

    // A board is solvable iff its reduction leaves no residual.
    isSolvable(board) {
      return api.reduce(board).rem === 0n;
    },

    // The witness that a board is *not* solvable: a kernel vector with odd overlap, i.e.
    // a row of the echelon form that reads `0 = 1`. Null when the board is solvable.
    certificate(board) {
      for (const z of coset) if (z && dotGF2(z, board) === 1) return z;
      return null;
    },

    // min weight(x) over the coset x_p + ker(M). That number is the game's par.
    minPresses(board) {
      const { rem, comb } = api.reduce(board);
      if (rem) {
        return { ok: false, board, residual: rem, certificate: api.certificate(board), cosetSize: coset.length };
      }
      let best = comb;
      let bestWeight = bitCount(comb);
      for (const z of coset) {
        if (!z) continue;
        const x = comb ^ z;
        const w = bitCount(x);
        if (w < bestWeight || (w === bestWeight && x < best)) {
          best = x;
          bestWeight = w;
        }
      }
      return {
        ok: true,
        board,
        presses: bestWeight,
        mask: best,
        pattern: maskPattern(n, best),
        cosetSize: coset.length,
        examined: coset.length,
      };
    },
  };

  solvers.set(n, api);
  return api;
}

function highestBitOfInt(m) {
  let k = 0;
  while (m > 1) {
    m >>= 1;
    k++;
  }
  return k;
}

export function rankNullity(n) {
  const s = getSolver(n);
  return { rank: s.rank, nullity: s.nullity, solvable: s.rank, total: s.size };
}

// The published count of solvable boards, 2^rank, as BigInt: 4x4 must come out 4096.
export function imageCount(n) {
  return 2n ** BigInt(getSolver(n).rank);
}

// Independent re-check of a certificate: M*y must vanish and y must overlap b oddly.
export function verifyCertificate(n, board, y) {
  return { killsMatrix: pressEffect(n, y) === 0n, parity: dotGF2(y, board) };
}

// Convenience for callers holding a board rather than a mask (the shell, the tests).
export function minPresses(n, board) {
  return getSolver(n).minPresses(board);
}
