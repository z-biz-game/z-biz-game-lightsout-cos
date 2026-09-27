// The two ways to answer "what is the fewest presses for this board?", kept deliberately
// separate so they can be held against each other.
//
//   solve()       — GF(2): reduce the board, enumerate the 2^nullity coset, take the lightest
//                   press set. This is what ships as `par`; cost is a dozen XORs, so the UI
//                   could run it on a tap and does not need to.
//   bfsTable() / bfsPresses() — no algebra at all: walk the press graph from the all-dark
//                   board and read off distances. Exponential, which is why it only runs in
//                   tools/bake.mjs (sampled) and test/gf2-vs-bfs.test.mjs (4x4 in full).
//
// If the algebra ever drifts — a wrong pivot, a coset that is not the coset — the sweep
// notices, because the two answers disagree on some board. That reconciliation, not either
// number alone, is what makes the printed par trustworthy.

import { getSolver } from './gf2.js';
import { flipMasks, cellCount } from './grid.js';

const MAX_SWEEP_BITS = 20; // 2^20 states is already a few seconds; 5x5 would be 33M.

// solve(board, n) -> { ok, presses, pattern, cosetSize, examined, rank, nullity }
//   or, for a board outside the column space,
//   { ok: false, residual, certificate, rank, nullity }
// `certificate` is a kernel vector with odd overlap with `board`: row y^T of the echelon
// form reads `0 = 1`. Callers must not treat ok:false as "unknown" — it is a proof.
export function solve(board, n) {
  const s = getSolver(n);
  const r = s.minPresses(board);
  return { ...r, rank: s.rank, nullity: s.nullity };
}

// Is the board clearable at all? Cheaper than solve() when only the yes/no is wanted.
export function isSolvable(board, n) {
  return getSolver(n).isSolvable(board);
}

// Breadth-first sweep of the whole press graph from the all-dark board: dist[board] is the
// true shortest press count, and boards never reached are unreachable by definition.
// Returns { dist, size, image, diameter, hist } where hist[d] is the number of boards at
// distance d. Refuses sizes whose graph would not fit in memory — 5x5 is 33M states and is
// covered by sampling instead (see DESIGN.md).
export function bfsTable(n) {
  const bits = cellCount(n);
  if (bits > MAX_SWEEP_BITS) {
    throw new Error(`${n}x${n} has 2^${bits} boards; a full sweep is out of the question (see DESIGN.md)`);
  }
  const cols = flipMasks(n);
  const total = 1 << bits;
  const dist = new Int16Array(total).fill(-1);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 1;
  dist[0] = 0;
  queue[0] = 0;
  const hist = [1];
  let diameter = 0;
  while (head < tail) {
    const s0 = queue[head++];
    const d = dist[s0];
    for (let j = 0; j < cols.length; j++) {
      const t = s0 ^ Number(cols[j]);
      if (dist[t] >= 0) continue;
      dist[t] = d + 1;
      queue[tail++] = t;
      if (hist[d + 1] === undefined) hist[d + 1] = 0;
      hist[d + 1]++;
      if (d + 1 > diameter) diameter = d + 1;
    }
  }
  let image = 0;
  for (let m = 0; m < total; m++) if (dist[m] >= 0) image++;
  return { dist, size: total, states: tail, image, diameter, hist };
}

// One board, same graph, no algebra, bounded: the second opinion for sampled boards.
// Returns { ok, presses } with ok:false meaning "unreachable" (a proof, since the graph is
// finite and was fully explored up to the cap) — unless truncated, which means "unknowable
// at this budget" and is never treated as an answer.
export function bfsPresses(n, board, opts = {}) {
  const limit = opts.limit || 200000;
  const target = Number(board);
  const cols = flipMasks(n);
  if (target === 0) return { ok: true, presses: 0, states: 1, truncated: false };
  const seen = new Set([0]);
  const queue = [0];
  const dist = [0];
  let head = 0;
  while (head < queue.length) {
    if (seen.size > limit) return { ok: false, presses: -1, states: seen.size, truncated: true };
    const s0 = queue[head];
    const d = dist[head++];
    for (let j = 0; j < cols.length; j++) {
      const t = s0 ^ Number(cols[j]);
      if (t === target) return { ok: true, presses: d + 1, states: seen.size, truncated: false };
      if (seen.has(t)) continue;
      seen.add(t);
      queue.push(t);
      dist.push(d + 1);
    }
  }
  return { ok: false, presses: -1, states: seen.size, truncated: false };
}

// The press set the shell reveals on the win card, in 1-based board coordinates. Built
// from the shipped pattern, never searched for.
export function patternCells(n, pattern) {
  return pattern.map((j) => ({ r: Math.floor(j / n) + 1, c: (j % n) + 1 }));
}
