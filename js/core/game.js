// The play state machine. Pure: it holds the board, the press count and the undo stack, and
// it knows nothing about canvas, routes or records. `press` is the only thing that changes a
// board during play, so the shell has exactly one place to count.
//
// Because pressing a key is its own inverse and presses commute, undo is not a special
// case: re-pressing the same key returns the board. The stack exists to count presses
// honestly (a player who presses the same key twice has used two presses) and to let
// 撤销/重做 walk the history, not because the rules need it.

import { boardOf, applyPress, cellsOf, isSolved, bitCount } from './grid.js';
import { patternCells } from './solve.js';

// createGame(lot) -> game. `lot` is a prepared entry from library.js: { n, board, par, keys }.
export function createGame(lot) {
  const start = boardOf(lot.board);
  return {
    id: lot.id,
    n: lot.n,
    par: lot.par,
    answer: lot.keys || null,
    start,
    board: start,
    presses: 0,
    back: [],
    fwd: [],
    done: isSolved(start),
  };
}

// The one move the game has: press key j. Returns the new board, or null when the press is
// not legal (off the board, or the puzzle is already over — pressing after the win would
// invent presses the record does not have).
export function press(game, j) {
  if (game.done) return null;
  if (!Number.isInteger(j) || j < 0 || j >= game.n * game.n) return null;
  game.back.push(j);
  game.fwd.length = 0;
  game.board = applyPress(game.board, game.n, j);
  game.presses += 1;
  game.done = isSolved(game.board);
  return game.board;
}

export function undo(game) {
  if (!game.back.length) return false;
  const j = game.back.pop();
  game.board = applyPress(game.board, game.n, j);
  game.presses -= 1;
  game.done = false;
  game.fwd.push(j);
  return true;
}

export function redo(game) {
  if (!game.fwd.length) return false;
  const j = game.fwd.pop();
  game.back.push(j);
  game.board = applyPress(game.board, game.n, j);
  game.presses += 1;
  game.done = isSolved(game.board);
  return true;
}

export function reset(game) {
  game.board = game.start;
  game.presses = 0;
  game.back.length = 0;
  game.fwd.length = 0;
  game.done = isSolved(game.start);
  return game;
}

export function boardCells(game) {
  return cellsOf(game.n, game.board);
}

export function litCount(game) {
  return bitCount(game.board);
}

// Three stars for matching the coset minimum, two for par+2 or better, one otherwise. The
// thresholds are the shell's opinion about effort, not a measurement: only `par` is.
export function grade(game) {
  if (!game.done) return { stars: 0, label: '还有灯亮着' };
  if (game.presses <= game.par) return { stars: 3, label: '最优熄灯' };
  if (game.presses <= game.par + 2) return { stars: 2, label: '干净收场' };
  return { stars: 1, label: '灯全熄了' };
}

// The win-card reveal: the shipped optimal key set as 1-based coordinates. Read from the
// baked lot, never searched for.
export function answerCells(game) {
  if (!game.answer) return [];
  return patternCells(game.n, game.answer);
}
