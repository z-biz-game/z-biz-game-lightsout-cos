// The shipped puzzle pool. The game picks boards from here; it never generates one, and
// that is a measured decision — see tools/bake.mjs.
//
// Everything below is a pure lookup over js/data/lots.js, which is why the daily puzzle and
// a shared #/lot/<id> link are reproducible without any state: the pool is fixed and the
// seed only chooses an index.
//
// validateLot() is the cheap structural gate; the expensive claim ("this board dies in
// exactly `par` presses") is re-derived by test/library.test.mjs from the serialised number
// on the line, so a hand-edited par or a stale bake fails a test instead of a player.

import { LOTS, TIERS_META } from '../data/lots.js';
import { boardOf, cellsOf, bitCount, applyPattern, allDark } from './grid.js';
import { getSolver } from './gf2.js';
import { hashSeed } from './rng.js';

// Display-side tier list (label / board size / band / blurb), measured off the lots that
// shipped — the generation-side ladder with its key dials lives in make.js.
export const TIERS = TIERS_META;

// A lot is legal when: the size is in the rank table, the board fits that many bits, the
// par is at least 1 and at most the number of keys, the recorded key set really is `par`
// long, and pressing that key set on an all-dark board yields exactly this board.
export function validateLot(lot) {
  if (!lot || typeof lot !== 'object') return 'not an object';
  if (!Number.isInteger(lot.n)) return `n must be an integer, got ${lot.n}`;
  const s = getSolver(lot.n);
  const board = boardOf(lot.board);
  if (board < 0n || board >= (1n << BigInt(lot.n * lot.n))) return `board does not fit ${lot.n}x${lot.n}`;
  if (!Number.isInteger(lot.par) || lot.par < 1) return `par ${lot.par} is not a positive whole number`;
  if (lot.par > lot.n * lot.n) return `par ${lot.par} exceeds the ${lot.n * lot.n} keys`;
  if (!Array.isArray(lot.keys) || lot.keys.length !== lot.par) {
    return `keys holds ${Array.isArray(lot.keys) ? lot.keys.length : 'nothing'}, par says ${lot.par}`;
  }
  for (const j of lot.keys) if (!Number.isInteger(j) || j < 0 || j >= lot.n * lot.n) return `key ${j} is off the board`;
  if (new Set(lot.keys).size !== lot.keys.length) return 'keys repeats a key, so it is not a press set';
  if (applyPattern(allDark(lot.n), lot.n, lot.keys) !== board) return 'the recorded press set does not produce this board';
  if (bitCount(board) !== lot.lit) return `lit ${lot.lit} disagrees with the board (${bitCount(board)})`;
  if (lot.rank !== s.rank || lot.nullity !== s.nullity) return 'the rank table this line was measured against is not the one loaded';
  return null;
}

const prepared = LOTS.map((row) => {
  const board = boardOf(row.board);
  return {
    id: row.id,
    tier: row.tier,
    n: row.n,
    board,
    cells: cellsOf(row.n, board),
    par: row.par,
    keys: row.keys,
    genKeys: row.genKeys,
    lit: row.lit,
    rank: row.rank,
    nullity: row.nullity,
    spec: row,
  };
});

export const ALL = prepared;

function pick(list, seed, salt) {
  if (!list.length) return null;
  return list[hashSeed(`${salt}|${seed}`) % list.length];
}

export function tierByKey(key) {
  return TIERS.find((t) => t.key === key) || TIERS[0];
}

export function lotsIn(key) {
  return prepared.filter((l) => l.tier === key);
}

export function byId(id) {
  return prepared.find((l) => l.id === id) || null;
}

// The campaign: every baked lot, easiest band first and within a band the lightest par
// first — exactly the order tools/bake.mjs wrote them in.
export function campaign() {
  return prepared;
}

export function levelAt(index) {
  return prepared[((index % prepared.length) + prepared.length) % prepared.length];
}

// One puzzle per calendar day, the same for everyone.
export function dailyLot(dateKey) {
  return pick(prepared, dateKey, 'daily');
}

function median(sorted) {
  const m = sorted.length >> 1;
  return sorted.length % 2 ? sorted[m] : Math.round((sorted[m - 1] + sorted[m]) / 2);
}

// What the shipped pool actually contains, measured rather than claimed, so a re-bake that
// quietly loses difficulty shows up as a moved band. The median is there for the same
// reason: a tier where every lot lands on the same number is one puzzle wearing many hats.
export function stats() {
  const byTier = {};
  for (const l of prepared) {
    const s = byTier[l.tier] || (byTier[l.tier] = {
      n: 0, min: Infinity, max: 0, pars: [], lits: [], cellsMin: Infinity, cellsMax: 0, genMin: Infinity, genMax: 0,
    });
    s.n++;
    s.min = Math.min(s.min, l.par);
    s.max = Math.max(s.max, l.par);
    s.cellsMin = Math.min(s.cellsMin, l.n * l.n);
    s.cellsMax = Math.max(s.cellsMax, l.n * l.n);
    s.genMin = Math.min(s.genMin, l.genKeys);
    s.genMax = Math.max(s.genMax, l.genKeys);
    s.pars.push(l.par);
    s.lits.push(l.lit);
  }
  for (const s of Object.values(byTier)) {
    s.pars.sort((a, b) => a - b);
    s.parMed = median(s.pars);
    s.litMin = Math.min(...s.lits);
    s.litMax = Math.max(...s.lits);
    delete s.pars;
    delete s.lits;
  }
  return { lots: prepared.length, byTier };
}

// The table README quotes, recomputed from the shipped file rather than pasted:
// `node -e "import('./js/core/library.js').then(m => console.table(m.summaryTable()))"`.
export function summaryTable() {
  const s = stats();
  return TIERS.map((t) => {
    const m = s.byTier[t.key] || { n: 0, parMed: 0, litMin: 0, litMax: 0, genMin: 0, genMax: 0 };
    return {
      tier: t.key,
      label: t.label,
      board: `${t.n}x${t.n}`,
      lots: m.n,
      par: `${m.min}-${m.max}`,
      parMed: m.parMed,
      lit: `${m.litMin}-${m.litMax}`,
      dial: `${m.genMin}-${m.genMax}`,
    };
  });
}
