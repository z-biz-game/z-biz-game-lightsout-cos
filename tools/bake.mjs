// The content pipeline. This is where the puzzles in this game come from — the browser
// never generates a board, it only picks one.
//
// Why offline, when a coset enumeration costs a dozen XORs: the *dial* has to be searched.
// Hitting a par window means trying key sets and measuring the result, and the rejects are
// a large and uneven share of the attempts (bake prints the real numbers). What ships is
// the measured set: every line is re-solved from its serialised form before it is written,
// and on 4x4 re-checked against the press graph, so nothing unmeasured gets printed.
//
//   node tools/bake.mjs
//   PER_TIER=24 node tools/bake.mjs
//
// `par` on a line is the minimum weight of the coset of ker(M) that solves that board, and
// the run below proves it still is.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TIERS, makePuzzle, tierByKey } from '../js/core/make.js';
import { solve, bfsPresses, bfsTable } from '../js/core/solve.js';
import { boardOf, boardToNumber, applyPattern } from '../js/core/grid.js';
import { getSolver, imageCount, rankNullity } from '../js/core/gf2.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const PER_TIER = Number(process.env.PER_TIER || 8);
const SEED_CAP = Number(process.env.SEED_CAP || PER_TIER * 60);

// A board is its own identity: two key sets that produce the same lights are the same puzzle.
function boardKey(lot) {
  return `${lot.n}:${lot.board}`;
}

console.log('rank table (measured at bake time, pinned in test/gf2.test.mjs):');
for (const n of [3, 4, 5, 6, 7]) {
  const r = rankNullity(n);
  console.log(`  ${n}x${n}  rank=${r.rank} nullity=${r.nullity} image=${imageCount(n)} of 2^${n * n}`);
}

const out = [];
const report = [];
const t0 = Date.now();
for (const tier of TIERS) {
  const seen = new Set();
  const picked = [];
  const rejects = {};
  let attempts = 0;
  let worstBfs = 0;
  const tt = Date.now();
  for (let s = 0; picked.length < PER_TIER && s < SEED_CAP; s++) {
    attempts++;
    const lot = makePuzzle(`bake-${tier.key}-${s}`, tier.key);
    if (!lot.ok) {
      rejects[lot.reason] = (rejects[lot.reason] || 0) + 1;
      continue;
    }
    const key = boardKey(lot);
    if (seen.has(key)) {
      rejects.duplicate = (rejects.duplicate || 0) + 1;
      continue;
    }
    // Serialise first, then re-solve the serialised form: the number that ships must be a
    // property of the text in js/data/lots.js, not of an object that only exists in memory.
    const row = {
      id: `${tier.key}-${String(picked.length + 1).padStart(2, '0')}`,
      tier: tier.key,
      n: lot.n,
      board: boardToNumber(boardOf(lot.board)),
      par: lot.par,
      keys: lot.pattern,
      genKeys: lot.keys,
      lit: lot.lit,
      rank: lot.rank,
      nullity: lot.nullity,
    };
    const again = solve(boardOf(row.board), row.n);
    if (!again.ok || again.presses !== row.par || again.pattern.join(',') !== row.keys.join(',')) {
      throw new Error(`${row.id}: par ${row.par} not reproducible from the serialised board (${again.presses})`);
    }
    // Independent second opinion on the small board: distance in the press graph. 5x5 has
    // 2^23 reachable boards, so BFS there is a sampling exercise, not a proof (DESIGN.md).
    if (row.n === 4) {
      const b = bfsPresses(4, boardOf(row.board), { limit: 20000 });
      if (!b.ok || b.presses !== row.par) {
        throw new Error(`${row.id}: press-graph BFS says ${b.ok ? b.presses : 'unreachable'}, par claims ${row.par}`);
      }
      worstBfs = Math.max(worstBfs, b.states);
    }
    seen.add(key);
    picked.push(row);
  }
  const ms = Date.now() - tt;
  const pars = picked.map((p) => p.par);
  report.push({
    tier: tier.key,
    label: tier.label,
    n: tier.n,
    dial: tier.keys.join('-'),
    window: tier.par.join('-'),
    wanted: PER_TIER,
    accepted: picked.length,
    attempts,
    rate: attempts ? `${Math.round((picked.length / attempts) * 100)}%` : 'n/a',
    parMin: Math.min(...pars),
    parMax: Math.max(...pars),
    rejects,
    ms,
    bfsStates: worstBfs,
  });
  if (picked.length < PER_TIER) console.error(`warn: ${tier.key} only reached ${picked.length}/${PER_TIER} in ${attempts} attempts`);
  // A band is played as a curve, so order it by the one number that means something.
  picked.sort((a, b) => a.par - b.par || a.lit - b.lit || a.board.localeCompare(b.board));
  picked.forEach((p, i) => { p.id = `${tier.key}-${String(i + 1).padStart(2, '0')}`; });
  out.push(...picked);
}

console.log('');
for (const r of report) {
  console.log(
    `${r.tier.padEnd(9)} ${r.n}x${r.n}  dial=${String(r.dial).padEnd(6)} window=${String(r.window).padEnd(6)}`
    + ` accepted=${String(r.accepted).padStart(2)}/${r.wanted} attempts=${String(r.attempts).padStart(3)} accept=${r.rate.padStart(4)}`
    + ` par=${r.parMin}-${r.parMax}  ${r.ms}ms`
    + (r.bfsStates ? ` bfsStates<=${r.bfsStates}` : '')
    + `\n          rejects: ${Object.entries(r.rejects).map(([k, v]) => `${k}:${v}`).join(' ') || 'none'}`,
  );
}
console.log(`total ${Date.now() - t0}ms for ${out.length} lots`);

// The bands the UI prints are measured off the lots that actually shipped, not copied from
// the generator's wish list — so a re-bake that lands lighter or heavier says so.
const meta = TIERS.map((t) => {
  const mine = out.filter((l) => l.tier === t.key).map((l) => l.par);
  if (!mine.length) throw new Error(`tier ${t.key} shipped nothing`);
  const lo = Math.min(...mine);
  const hi = Math.max(...mine);
  return {
    key: t.key,
    label: t.label,
    n: t.n,
    min: lo,
    max: hi,
    blurb: `${t.n}×${t.n} · ${lo === hi ? lo : `${lo}-${hi}`} 按`,
  };
});

// Nobody's word for the shipped lines: the recorded key set must really clear the board,
// and must have been measured against the rank table that is loaded right now.
for (const row of out) {
  const s = getSolver(row.n);
  if (row.rank !== s.rank || row.nullity !== s.nullity) throw new Error(`${row.id}: rank table drifted since measurement`);
  if (applyPattern(boardOf(row.board), row.n, row.keys) !== 0n) throw new Error(`${row.id}: its own solution does not clear it`);
}

const lines = [
  '// Generated by tools/bake.mjs — the boards in this game are measurements, not opinions.',
  '// `par` is the minimum weight of the GF(2) coset that solves `board` (a decimal string of',
  '// n*n bits), and `keys` is one press set that achieves it. Re-run `node tools/bake.mjs`',
  '// instead of hand-editing: `node test/library.test.mjs` re-solves every line below and',
  '// fails if a line and its number ever disagree.',
  `export const TIERS_META = ${JSON.stringify(meta)};`,
  'export const LOTS = [',
  ...out.map((l) => `  ${JSON.stringify(l)},`),
  '];',
  '',
];
const path = join(root, 'js', 'data', 'lots.js');
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, lines.join('\n'));

// 4x4 is small enough that the whole press graph is a fact, not a sample: print its shape so
// the deliverable can quote the diameter next to the pool's bands.
const tab = bfsTable(4);
console.log(`4x4 press graph: image=${tab.image} boards reachable, diameter=${tab.diameter} presses, hist=${tab.hist.filter((v) => v !== undefined).join(' ')}`);

const byTier = {};
for (const l of out) byTier[l.tier] = (byTier[l.tier] || 0) + 1;
console.log(`wrote ${out.length} lots (${Object.entries(byTier).map(([k, n]) => `${k}:${n}`).join(' ')}) -> js/data/lots.js`);
