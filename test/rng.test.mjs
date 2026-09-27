// The seed → numbers pipeline. This module is the reason two devices agree on what puzzle
// "dim|abandon" is, so it is pinned from the outside: every constant below was computed with a
// separate 32-bit implementation (plain integer arithmetic in another language), not read out
// of js/core/rng.js. If someone rewrites hashSeed, these numbers disagree first.

import { test, run, ok, eq } from '../tools/harness.mjs';
import { hashSeed, mulberry32, rngFrom, todayKey } from '../js/core/rng.js';

const MASK = (1n << 32n) - 1n;
const PRIME = 0x01000193n;
const BASIS = 0x811c9dc5n;

// The documented algorithm, expressed once with BigInt so it cannot share an overflow bug with
// the Math.imul version: for every UTF-16 code unit, fold the low byte and multiply, then fold
// the high byte and multiply again.
function foldTwice(codeUnits) {
  let h = BASIS;
  for (const c of codeUnits) {
    h = ((h ^ BigInt(c & 0xff)) * PRIME) & MASK;
    h = ((h ^ BigInt((c >> 8) & 0xff)) * PRIME) & MASK;
  }
  return Number(h);
}

// Textbook FNV-1a folds one byte per round; the published vector for "a" is 0xE40C292C.
const TEXTBOOK_A = 0xe40c292c;

test('the empty seed is the offset basis, untouched by the loop', () => {
  eq(hashSeed(''), 2166136261, '0x811c9dc5 exactly, because the body never runs');
  eq(hashSeed(''), 0x811c9dc5);
  eq(foldTwice([]), hashSeed(''), 'and the independent form agrees');
});

test('two rounds per character: a variant, and knowingly not textbook FNV-1a', () => {
  // The low/high split is what makes non-ASCII seeds work, and the price is that the published
  // single-byte vectors no longer apply past the empty string. Pinned both ways so a future
  // "let me fix this toward the RFC" edit cannot silently re-map every seed in the game.
  eq(hashSeed('a'), 723832900, '0x2b24d044: basis -> fold 0x61 -> mul -> fold 0x00 -> mul');
  ok(hashSeed('a') !== TEXTBOOK_A, 'hashSeed("a") is NOT the textbook FNV-1a vector, by design');
  eq(hashSeed('a'), foldTwice('a'.split('').map((s) => s.charCodeAt(0))));
  eq(hashSeed('☀'), 729202875, 'U+2600: the high byte 0x26 really is folded, not dropped');
  eq(hashSeed('☀'), foldTwice([0x2600]));
});

test('every seed the game uses is pinned to a second implementation', () => {
  const cases = [
    ['ab', 2174188438],
    ['abc', 2921240957],
    ['lightsout', 496022238],
    ['faint', 3844779121],
    ['dim', 4020004693],
    ['shadow', 2666620843],
    ['blackout', 1574323644],
    ['daily|2026-09-27', 2210448354],
    ['faint|abandon', 742393652],
  ];
  for (const [s, want] of cases) {
    const units = [];
    for (let i = 0; i < s.length; i++) units.push(s.charCodeAt(i));
    eq(hashSeed(s), want, `${s} -> ${want}`);
    eq(hashSeed(s), foldTwice(units), `${s} recomputed by the BigInt form`);
  }
});

test('hashSeed is a pure uint32 function of its argument', () => {
  for (const s of ['', 'a', 'ab', 'faint', 'blackout', '☀', 'daily|2026-09-27']) {
    eq(hashSeed(s), hashSeed(s), 'stable across calls');
    ok(Number.isInteger(hashSeed(s)) && hashSeed(s) >= 0 && hashSeed(s) <= 0xffffffff, `${s} stays a uint32`);
    eq(s.length, s.length, 'and the argument is not mutated (strings cannot be)');
  }
  const seen = new Set();
  for (let i = 0; i < 400; i++) seen.add(hashSeed(`lot-${i}`));
  ok(seen.size > 395, '400 nearby seeds do not collide into a handful of boards');
  ok(hashSeed('a') !== hashSeed('b'), 'one character changes the whole value');
});

test('mulberry32: the published generator, eight outputs per seed', () => {
  // Each expected value is k / 2^32 for the uint32 k derived independently; writing the
  // fraction (not a rounded decimal) keeps the comparison exact.
  const cases = [
    [0, [0x4434b462, 0x00159c37, 0x39285b08, 0x256d8104, 0x77a2cbd4, 0x8b885631, 0x9d811d5f, 0xa623e7e6]],
    [1, [0xa087eaf3, 0x00b349c9, 0x8706c4eb, 0xfb2627fd, 0xf7e79d2b, 0x47f66630, 0x9ce301f0, 0xb8829f5c]],
    [0x811c9dc5, [0x9c7a8434, 0x7e579ba5, 0xc6267ea9, 0x698b9526, 0xcff0a677, 0x0ea53262, 0xea78addf, 0x318fc574]],
    [3844779121, [0x4a1f43e9, 0xad398a6c, 0x23e414f4, 0x005d1bcd, 0x0f9f5ac6, 0xd04c5dc9, 0xf555c670, 0xb020b080]],
    [2210448354, [0x5b547532, 0xa952f5f5, 0xe502dd25, 0xdd49d925, 0x4f539b2b, 0x8b875a32, 0xf27d0644, 0x91c062c9]],
  ];
  for (const [seed, ks] of cases) {
    const rng = mulberry32(seed);
    for (let i = 0; i < ks.length; i++) eq(rng(), ks[i] / 4294967296, `seed ${seed} output ${i}`);
  }
});

test('the stream is exactly a sequence of uint32 over 2^32, in [0,1)', () => {
  const rng = mulberry32(hashSeed('uniform'));
  let sum = 0;
  let low = 0;
  let high = 0;
  const seen = new Set();
  for (let i = 0; i < 5000; i++) {
    const x = rng();
    ok(x >= 0 && x < 1, `${x} in range`);
    ok(Number.isInteger(x * 4294967296), `${x} is a multiple of 2^-32`);
    sum += x;
    if (x < 0.5) low++;
    else high++;
    seen.add(x);
  }
  ok(Math.abs(sum / 5000 - 0.5) < 0.02, 'mean near a half');
  ok(low > 2300 && high > 2300, 'no half of the interval is starved');
  ok(seen.size > 4990, 'and it does not repeat inside a short run');
});

test('same seed, same stream; different seed, different stream', () => {
  const grab = (seed) => {
    const r = mulberry32(seed);
    return [r(), r(), r(), r()];
  };
  eq(grab(hashSeed('dim')), grab(hashSeed('dim')), 'two runs of the same seed agree');
  ok(String(grab(hashSeed('dim'))) !== String(grab(hashSeed('shadow'))), 'neighbouring tier names diverge');
  const a = mulberry32(7);
  const b = mulberry32(7);
  eq(a(), b(), 'independent generators, same first value');
  eq(a(), b(), 'and they stay in step');
});

test('rngFrom: three doors and a passthrough', () => {
  const fromText = rngFrom('faint');
  const fromNumber = mulberry32(hashSeed('faint'));
  eq(fromText(), fromNumber(), 'a string seed means mulberry32(hashSeed(string))');
  eq(rngFrom(1)(), mulberry32(1)(), 'a number seed is taken as the state itself');
  const made = mulberry32(3);
  ok(rngFrom(made) === made, 'an rng is passed through, so a caller can hand one down');
  eq(rngFrom('42')(), rngFrom('42')(), 'and the door chosen is not random');
  ok(rngFrom(0) !== rngFrom(1), 'different states, different objects');
});

test('int / range / pick / chance / shuffle do what their names say', () => {
  const rng = rngFrom('helpers');
  for (let i = 0; i < 500; i++) {
    const k = rng.int(16);
    ok(Number.isInteger(k) && k >= 0 && k < 16, `int(16) -> ${k}`);
    const r = rng.range(3, 7);
    ok(Number.isInteger(r) && r >= 3 && r <= 7, `range(3,7) -> ${r} (both ends reachable)`);
    const c = rng.chance(0.5);
    ok(typeof c === 'boolean');
  }
  const letters = ['a', 'b', 'c', 'd', 'e'];
  const picked = new Set();
  for (let i = 0; i < 300; i++) picked.add(rng.pick(letters));
  eq(picked.size, 5, 'pick reaches every element');
  ok(rng.pick(letters) !== undefined, 'and never hands back nothing');
  ok(rng.chance(0) === false, 'chance(0) is impossible');
  ok(rng.chance(1) === true, 'chance(1) is certain');

  const deck = Array.from({ length: 12 }, (_, i) => i);
  const shuffled = rngFrom('shuffle').shuffle([...deck]);
  eq(shuffled.length, 12, 'shuffle is a permutation, not a filter');
  eq([...shuffled].sort((x, y) => x - y), deck, 'every card still there');
  eq(rngFrom('shuffle').shuffle([...deck]), shuffled, 'same seed, same order');
  ok(String(rngFrom('other').shuffle([...deck])) !== String(shuffled), 'a different seed, a different order');
  const sortedAgain = rngFrom('order').shuffle([3, 1, 2]).sort((x, y) => x - y);
  eq(sortedAgain, [1, 2, 3], 'shuffling cannot invent or lose values');
});

test('todayKey is a local, zero-padded calendar date', () => {
  eq(todayKey(new Date(2026, 8, 27)), '2026-09-27', 'September is 09, not 8');
  eq(todayKey(new Date(2025, 0, 5)), '2025-01-05', 'and the fifth is 05, not 5');
  eq(todayKey(new Date(2026, 11, 31, 23, 59, 59)), '2026-12-31', 'late on the last day of the year');
  eq(todayKey(new Date(2026, 8, 27, 0, 0, 0)), '2026-09-27', 'and early on the same one');
  const keys = new Set();
  for (let i = 0; i < 365; i++) {
    const k = todayKey(new Date(2026, 0, 1 + i));
    ok(/^\d{4}-\d{2}-\d{2}$/.test(k), `${k} has the shape the save file and daily picker expect`);
    keys.add(k);
  }
  eq(keys.size, 365, 'one key per day, no collisions across a year');
  ok(keys.has('2026-01-01') && keys.has('2026-12-31'), 'the first and the last day are both in there');
});

run();
