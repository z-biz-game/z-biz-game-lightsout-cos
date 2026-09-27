// The shipped pool, re-measured. bake.mjs certifies a lot as it writes it; this suite
// certifies whatever is actually in js/data/lots.js, so a hand-edited par, a stale bake or a
// truncated file fails here rather than in someone's face.

import { test, run, ok, eq } from '../tools/harness.mjs';
import { TIERS, ALL, byId, lotsIn, campaign, levelAt, tierByKey, dailyLot, stats, summaryTable, validateLot } from '../js/core/library.js';
import { LOTS } from '../js/data/lots.js';
import { solve } from '../js/core/solve.js';
import { getSolver } from '../js/core/gf2.js';
import { boardOf, applyPattern, bitCount, cellsOf } from '../js/core/grid.js';
import { hashSeed } from '../js/core/rng.js';
import { RANK_TABLE } from './fixture.mjs';

test('the pool is not empty and every entry passes its own validation', () => {
  ok(ALL.length >= 32, `there should be a game here, got ${ALL.length} lots`);
  eq(ALL.length, LOTS.length, 'nothing was dropped on the way in');
  for (const lot of ALL) eq(validateLot(lot.spec), null, `${lot.id} is not a legal lot`);
});

test('every printed par reproduces from the serialised board', () => {
  const wrong = [];
  for (const lot of ALL) {
    const r = solve(lot.board, lot.n);
    if (!r.ok || r.presses !== lot.par) wrong.push(`${lot.id}: claims ${lot.par}, coset says ${r.ok ? r.presses : 'unsolvable'}`);
    if (r.ok && r.pattern.join(',') !== lot.keys.join(',')) wrong.push(`${lot.id}: keys ${lot.keys} is not the lightest set ${r.pattern}`);
    if (applyPattern(lot.board, lot.n, lot.keys) !== 0n) wrong.push(`${lot.id}: its own key set does not clear it`);
  }
  eq(wrong, [], 'a level is a measurement, so the measurement has to still hold');
});

test('validateLot says no to each way a line could be wrong', () => {
  const good = ALL[0].spec;
  const clone = () => JSON.parse(JSON.stringify(good));
  const board = boardOf(good.board);
  eq(validateLot(good), null, 'the shape of the argument is the shape of the file');

  let l = clone(); l.par += 1;
  ok(/keys holds/.test(validateLot(l)), `a par raised without its keys: ${validateLot(l)}`);
  l = clone(); l.keys = l.keys.slice(1); l.par = l.keys.length;
  ok(/does not produce this board/.test(validateLot(l)), `a dropped key: ${validateLot(l)}`);
  l = clone(); l.board = (board ^ 1n).toString();
  ok(/does not produce this board/.test(validateLot(l)), 'a flipped cell in the board');
  l = clone(); l.keys[l.keys.length - 1] = l.keys[0];
  ok(/repeats a key/.test(validateLot(l)), 'a press set is a set');
  l = clone(); l.lit = bitCount(board) + 1;
  ok(/lit/.test(validateLot(l)), 'the light count has to match the board');
  l = clone(); l.n = 5;
  ok(/does not produce this board|does not fit|off the board/.test(validateLot(l)), `a 4x4 board wearing a 5 label: ${validateLot(l)}`);
  l = clone(); l.rank = 23;
  ok(/rank table/.test(validateLot(l)), 'a line measured against the wrong table');
  l = clone(); l.par = 0;
  ok(/positive whole number/.test(validateLot(l)), 'a puzzle that needs no pressing is not a puzzle');
  l = clone(); l.board = '99999999999999999999';
  ok(/does not fit/.test(validateLot(l)), 'a board too wide for its own size');
  eq(validateLot(null), 'not an object');
  eq(validateLot('x'), 'not an object');
});

test('ids are unique, shaped after their band, and every band ships something', () => {
  const seen = new Set();
  for (const lot of ALL) {
    ok(!seen.has(lot.id), `${lot.id} appears twice`);
    seen.add(lot.id);
    ok(new RegExp(`^${lot.tier}-\\d+$`).test(lot.id), `${lot.id} does not look like a ${lot.tier} id`);
    ok(lot.par >= 1, `${lot.id} starts with the board already dark`);
    ok(lot.genKeys >= lot.par, `${lot.id} was dialed below its own minimum`);
  }
  for (const tier of TIERS) ok(lotsIn(tier.key).length > 0, `${tier.key} shipped nothing`);
});

test('the bands on screen are the bands in the file', () => {
  const s = stats();
  eq(s.lots, ALL.length);
  for (const tier of TIERS) {
    const pars = lotsIn(tier.key).map((l) => l.par);
    eq([tier.min, tier.max], [Math.min(...pars), Math.max(...pars)], `${tier.key} band`);
    eq([s.byTier[tier.key].min, s.byTier[tier.key].max], [tier.min, tier.max], `${tier.key} stats`);
    ok(/按/.test(tier.blurb), `${tier.key} advertises its band in the blurb`);
    for (const l of lotsIn(tier.key)) eq(l.n, tier.n, `${l.id} is on the ${tier.key} shelf but not its board`);
  }
  for (let i = 1; i < TIERS.length; i++) {
    ok(TIERS[i].min > TIERS[i - 1].max, `bands must not overlap: ${TIERS.map((t) => `${t.key} ${t.min}-${t.max}`).join(' · ')}`);
  }
});

test('the pool summary the docs are copied from is finite and inside its band', () => {
  const s = stats();
  for (const tier of TIERS) {
    const m = s.byTier[tier.key];
    for (const [k, v] of Object.entries(m)) ok(Number.isFinite(v), `${tier.key}.${k} is ${v}, not a number`);
    ok(m.min <= m.parMed && m.parMed <= m.max, `${tier.key} median ${m.parMed} outside its band ${m.min}-${m.max}`);
    ok(m.cellsMin === m.cellsMax, `${tier.key} mixes board sizes, and the shelf says one thing`);
    ok(m.litMin >= 1 && m.litMax <= m.cellsMax, `${tier.key} has ${m.litMin}-${m.litMax} lights on a ${m.cellsMax}-cell board`);
    ok(m.genMin <= m.genMax, `${tier.key} dial range is inverted`);
  }
  const table = summaryTable();
  eq(table.length, TIERS.length);
  for (const row of table) {
    ok(/^\d+x\d+$/.test(row.board), `${row.tier} board label ${row.board}`);
    eq(row.lots, lotsIn(row.tier).length);
    eq(row.par, `${row.tier === '' ? '' : stats().byTier[row.tier].min}-${stats().byTier[row.tier].max}`);
  }
});

test('the campaign walks upwards and wraps around', () => {
  eq(campaign().length, ALL.length);
  for (const tier of TIERS) {
    const pars = lotsIn(tier.key).map((l) => l.par);
    eq(pars, [...pars].sort((a, b) => a - b), `${tier.key} is not sorted lightest first`);
  }
  const order = campaign().map((l) => TIERS.findIndex((t) => t.key === l.tier));
  eq(order, [...order].sort((a, b) => a - b), 'a band must not reappear after a harder one');
  eq(levelAt(0).id, ALL[0].id);
  eq(levelAt(-1).id, ALL[ALL.length - 1].id, 'walking off the front lands at the back');
  eq(levelAt(ALL.length).id, ALL[0].id, 'and off the end lands at the start');
  eq(byId('not-a-real-lot'), null);
  eq(byId(ALL[3].id), ALL[3]);
  eq(tierByKey('nonsense'), TIERS[0], 'an unknown band falls back rather than crashing the route');
});

test('a shared pick is the same pick, and it is the pick the URL promises', () => {
  const today = '2026-09-27';
  eq(dailyLot(today), dailyLot(today), 'the daily puzzle is a function of the date');
  ok(ALL.includes(dailyLot(today)), 'and it comes out of the pool');
  // The pick rule itself, recomputed here: hashSeed('daily|<date>') % |pool|.
  const index = hashSeed(`daily|${today}`) % ALL.length;
  eq(dailyLot(today).id, ALL[index].id, 'the daily board is chosen by the published index rule');
  const days = new Set();
  for (let d = 1; d <= 28; d++) days.add(dailyLot(`2026-09-${String(d).padStart(2, '0')}`).id);
  ok(days.size >= 8, `28 consecutive days spread over only ${days.size} boards — the pool is not being used`);
  ok(dailyLot('2026-09-27').id !== dailyLot('2026-10-01').id || ALL.length === 1, 'different dates, different boards, usually');
});

test('a prepared lot carries the board in every form the shell needs', () => {
  for (const lot of ALL.slice(0, 6)) {
    eq(typeof lot.board, 'bigint', `${lot.id} working form`);
    eq(lot.cells.length, lot.n * lot.n, `${lot.id} cells`);
    eq(litCells(lot.cells), lot.lit, `${lot.id} lit count matches its cells`);
    eq(lot.cells, cellsOf(lot.n, lot.board), `${lot.id} cells derived from the board`);
    eq(lot.spec.board, lot.board.toString(), `${lot.id} keeps the serialised text`);
    eq(lot.rank, RANK_TABLE[lot.n].rank);
    eq(lot.nullity, RANK_TABLE[lot.n].nullity);
    eq(getSolver(lot.n).rank, RANK_TABLE[lot.n].rank, 'the table the lot was measured against is loaded');
  }
});

function litCells(cells) {
  return cells.reduce((a, b) => a + b, 0);
}

test('the shelf gets harder as it goes up', () => {
  const first = lotsIn(TIERS[0].key);
  const last = lotsIn(TIERS[TIERS.length - 1].key);
  ok(last[last.length - 1].par > first[0].par * 2, 'the hardest lot outshines the easiest by more than a double');
  eq(first[0].n, 4);
  eq(last[0].n, 5, 'and the top band is the bigger board');
  for (const lot of ALL) ok(lot.keys.length === lot.par, `${lot.id} ships an answer of the wrong length`);
});

run();
