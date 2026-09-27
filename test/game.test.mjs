// The play state machine: what a press does, what undo/redo owe the player, and how the
// star grade is decided. This is the layer the browser drives, so its bookkeeping has to be
// exact even where the rules are trivial.

import { test, run, ok, eq } from '../tools/harness.mjs';
import { createGame, press, undo, redo, reset, boardCells, litCount, grade, answerCells } from '../js/core/game.js';
import { ALL } from '../js/core/library.js';
import { applyPattern, allLit, boardOf, cellsOf } from '../js/core/grid.js';
import { mulberry32, hashSeed } from '../js/core/rng.js';

// A tiny hand-built lot, so the suite does not depend on what the bake happened to ship.
const HANDLOT = {
  id: 'hand-01',
  n: 4,
  board: '171', // the faint-01 board: keys 1 and 3, par 2 (fixture, verified against grid)
  par: 2,
  keys: [1, 3],
  genKeys: 2,
  lit: 5,
};

test('a fresh game is the lot: board, par and no presses', () => {
  const g = createGame(HANDLOT);
  eq(g.n, 4);
  eq(g.par, 2);
  eq(g.presses, 0);
  eq(g.done, false, 'the hand lot is not already dark');
  eq(g.board, boardOf(HANDLOT.board), 'the board arrives in the working form');
  eq(g.back, []);
  eq(g.fwd, []);
  eq(boardCells(g), cellsOf(4, boardOf('171')), 'and the cells are the board');
  eq(litCount(g), 5);
});

test('a press flips the cross and counts one', () => {
  const g = createGame(HANDLOT);
  const before = g.board;
  const after = press(g, 1);
  eq(after, applyPattern(before, 4, [1]), 'the board is the old board plus the key');
  eq(g.presses, 1);
  eq(g.back, [1]);
  ok(after !== before, 'and a press always changes something');
});

test('pressing the shipped answer in any order wins in exactly par presses', () => {
  const rng = mulberry32(hashSeed('shuffle-answer'));
  for (const lot of ALL) {
    const g = createGame(lot);
    const order = rng.shuffle([...lot.keys]);
    for (const j of order) ok(press(g, j) !== null, `${lot.id}: key ${j} is pressable`);
    eq(g.done, true, `${lot.id} is dark after its own answer`);
    eq(g.presses, lot.par, `${lot.id} used exactly par presses, in shuffled order`);
    eq(litCount(g), 0);
    eq(grade(g).stars, 3, `${lot.id} scores three stars`);
  }
});

test('pressing the same key twice is two presses and no progress', () => {
  const g = createGame(HANDLOT);
  press(g, 1);
  press(g, 1);
  eq(g.board, g.start, 'the board is back where it started');
  eq(g.presses, 2, 'but the presses were spent, and the record says so');
  eq(g.done, false);
});

test('illegal presses are refused and cost nothing', () => {
  const g = createGame(HANDLOT);
  for (const bad of [-1, 16, 99, 3.5, '2', null, undefined, NaN]) {
    eq(press(g, bad), null, `key ${String(bad)} is not on the board`);
  }
  eq(g.presses, 0, 'and none of them counted');
  eq(g.board, g.start);
  // Finish it, then try to keep playing.
  press(g, 1);
  press(g, 3);
  eq(g.done, true);
  eq(press(g, 0), null, 'a solved board takes no more presses');
  eq(g.presses, 2, 'and none were billed');
});

test('undo walks the history back and redo walks it forward', () => {
  const g = createGame(HANDLOT);
  eq(undo(g), false, 'nothing to undo at the start');
  press(g, 1);
  press(g, 3);
  eq(g.done, true);
  eq(undo(g), true);
  eq(g.done, false, 'undoing the winning press unsolves the board');
  eq(g.presses, 1);
  eq(g.board, applyPattern(g.start, 4, [1]));
  eq(undo(g), true);
  eq([g.presses, g.board], [0, g.start]);
  eq(undo(g), false, 'and the stack is empty');
  eq(redo(g), true);
  eq([g.presses, g.done], [1, false]);
  eq(redo(g), true);
  eq([g.presses, g.done], [2, true]);
  eq(redo(g), false, 'the whole history came back');
  // A new press after an undo throws the redo branch away, like every other undo stack.
  undo(g);
  press(g, 7);
  eq(g.fwd, [], 'redo is gone once the player goes a different way');
  eq(redo(g), false);
});

test('reset puts the board, the count and both stacks back', () => {
  const g = createGame(HANDLOT);
  press(g, 0);
  press(g, 1);
  press(g, 2);
  const mid = g.board;
  reset(g);
  eq([g.board, g.presses, g.done], [g.start, 0, false]);
  eq(g.back, []);
  eq(g.fwd, []);
  ok(mid !== g.start, 'the mid-game board it undid was genuinely different');
  eq(redo(g), false, 'reset also clears the redo branch');
});

test('the grade is a statement about presses versus par', () => {
  const g = createGame({ ...HANDLOT, par: 2 });
  eq(grade(g), { stars: 0, label: '还有灯亮着' }, 'unfinished is not one star, it is none');
  press(g, 1);
  press(g, 3);
  eq(grade(g), { stars: 3, label: '最优熄灯' }, 'two presses on a par-2 board');
  reset(g);
  press(g, 1);
  press(g, 5);
  press(g, 5);
  press(g, 3);
  eq([g.presses, g.done], [4, true], 'wasted round trip still finishes it');
  eq(grade(g), { stars: 2, label: '干净收场' }, 'par+2 is two stars');
  reset(g);
  for (const j of [1, 1, 3, 3, 0, 0]) press(g, j);
  press(g, 1);
  press(g, 3);
  eq(g.done, true);
  eq(grade(g).stars, 1, 'anything beyond par+2 is still a win, just not a tidy one');
});

test('answerCells reveals the shipped key set in 1-based coordinates', () => {
  const g = createGame(HANDLOT);
  eq(answerCells(g), [{ r: 1, c: 2 }, { r: 1, c: 4 }], 'keys 1 and 3 are the first row, second and fourth cell');
  const noAnswer = createGame({ ...HANDLOT, keys: undefined });
  eq(answerCells(noAnswer), [], 'a lot without a stored answer reveals nothing rather than crashing');
});

test('a game created from an already-dark board is over before it starts', () => {
  const g = createGame({ id: 'zero', n: 4, board: '0', par: 1, keys: [0], genKeys: 1, lit: 0 });
  eq(g.done, true);
  eq(press(g, 0), null, 'and there is nothing to press');
  eq(grade(g).stars, 3, 'zero presses is at most par');
});

test('the big boards behave like the small ones', () => {
  const g = createGame({ id: 'lit5', n: 5, board: allLit(5).toString(), par: 15, keys: ALL.find((l) => l.id === 'blackout-07').keys, genKeys: 14, lit: 25 });
  eq(g.n, 5);
  eq(g.board, allLit(5));
  eq(litCount(g), 25);
  press(g, 0);
  eq(litCount(g), 22, 'pressing a corner of an all-lit 5x5 puts three lights out');
  eq(boardCells(g).length, 25);
  reset(g);
  eq(litCount(g), 25);
});

run();
