// The board: what a cell is, what a press does, and how both are stored.
//
// A board is one BigInt of n*n bits, bit i = cell i is LIT. A press set is a BigInt in the
// same shape, but its bits index *keys* (one key per cell, cell j is key j). Two algebraic
// facts make the rest of the game possible and are pinned in test/grid.test.mjs:
//
//   1. pressing a key is XOR with a fixed mask, so it is its own inverse (press twice = nothing);
//   2. XOR is commutative, so a press set — not a press order — is what determines the board.
//
// Everything here is pure and synchronous; nothing in js/core may touch the DOM.

export const MIN_N = 3;
export const MAX_N = 7;

// The cross neighbourhood of key j: the cell itself plus its four orthogonal neighbours,
// clipped by the rectangle. Rectangular only — a torus or an irregular board would change
// the rank table that every difficulty number in this repo is pinned to.
//
// Order is part of the contract, because the view and the playtest both read this array:
// the key's own cell first, then the rest in ascending cell order (reading order).
export function neighbours(n, j) {
  const r = Math.floor(j / n);
  const c = j % n;
  const near = [];
  if (r > 0) near.push(j - n);
  if (c > 0) near.push(j - 1);
  if (c < n - 1) near.push(j + 1);
  if (r < n - 1) near.push(j + n);
  return [j, ...near];
}

export function cellCount(n) {
  return n * n;
}

// The cells key j flips, as a BigInt mask. flipMask(n, j)[i] === flipMask(n, i)[j]: the
// toggle matrix is symmetric, and js/core/gf2.js leans on that to turn an unsolvable board
// into a checkable certificate.
export function flipMask(n, j) {
  let m = 0n;
  for (const i of neighbours(n, j)) m |= 1n << BigInt(i);
  return m;
}

// Columns of the toggle matrix, cached per board size: build once, use 2^16 times in the
// reconciliation sweep without rebuilding.
const columnCache = new Map();
export function flipMasks(n) {
  const hit = columnCache.get(n);
  if (hit) return hit;
  const cols = [];
  for (let j = 0; j < n * n; j++) cols.push(flipMask(n, j));
  columnCache.set(n, cols);
  return cols;
}

export function applyPress(board, n, j) {
  if (!Number.isInteger(j) || j < 0 || j >= n * n) throw new Error(`key ${j} is off the ${n}x${n} board`);
  return board ^ flipMasks(n)[j];
}

export function applyPattern(board, n, pattern) {
  let b = board;
  for (const j of pattern) b = applyPress(b, n, j);
  return b;
}

export function patternMask(n, pattern) {
  let m = 0n;
  for (const j of pattern) m |= 1n << BigInt(j);
  return m;
}

export function maskPattern(n, mask) {
  const out = [];
  for (let j = 0; j < n * n; j++) if ((mask >> BigInt(j)) & 1n) out.push(j);
  return out;
}

export function bitCount(mask) {
  let m = mask < 0n ? -mask : mask;
  let c = 0;
  while (m) {
    m &= m - 1n;
    c++;
  }
  return c;
}

export function highestBit(mask) {
  if (!mask) return -1;
  let k = 0;
  let m = mask;
  while (m > 1n) {
    m >>= 1n;
    k++;
  }
  return k;
}

export function hasBit(mask, i) {
  return ((mask >> BigInt(i)) & 1n) === 1n;
}

// board -> array of 0/1, index = r*n + c: what the view paints and what the shell counts.
export function cellsOf(n, board) {
  const out = new Array(n * n);
  for (let i = 0; i < n * n; i++) out[i] = hasBit(board, i) ? 1 : 0;
  return out;
}

export function boardFromCells(cells) {
  let m = 0n;
  for (let i = 0; i < cells.length; i++) if (cells[i]) m |= 1n << BigInt(i);
  return m;
}

// A board is serialised as a plain decimal number: 7x7 needs 49 bits, which a JS number
// cannot hold, so the string form is the transport and BigInt is the working form.
export function boardToNumber(board) {
  if (typeof board === 'string') return board;
  return board.toString();
}

export function boardOf(value) {
  if (typeof value === 'bigint') return value;
  return BigInt(value);
}

export function allLit(n) {
  return (1n << BigInt(n * n)) - 1n;
}

// The empty board of that size — where `make.js` starts pressing, and the board
// `library.js` replays a recorded key set on. A plain `0n` is the same value, but the two
// callers mean "the n×n all-dark board", so they say it with this.
export function allDark(n) {
  return 0n;
}

export function isSolved(board) {
  return board === 0n;
}

export function litCount(n, board) {
  return bitCount(board);
}

// Degrees of the keys, for the view (a corner key flips three cells, a centre key five).
export function keyDegrees(n) {
  return flipMasks(n).map(bitCount);
}

// Does this board size exist in this game at all? Guards the routes: a #/lot/<id> whose n
// is outside the table would build a matrix whose rank nobody measured.
export function validSize(n) {
  return Number.isInteger(n) && n >= MIN_N && n <= MAX_N;
}
