// The save file. The contract that matters here is not JSON, it is the guard: browsers do
// not hand you a null localStorage when storage is denied — they throw on the property
// access itself. Every path below is a way that a real browser can say no.

import { test, run, ok, eq } from '../tools/harness.mjs';
import { store, SAVE_KEY } from '../js/core/storage.js';

function fakeStore(overrides = {}) {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    ...overrides,
  };
}

function withLocalStorage(descriptor, body) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'localStorage');
  const previous = had ? Object.getOwnPropertyDescriptor(globalThis, 'localStorage') : undefined;
  if (descriptor === null) {
    delete globalThis.localStorage;
  } else {
    Object.defineProperty(globalThis, 'localStorage', { ...descriptor, configurable: true });
  }
  try {
    body();
  } finally {
    if (had) Object.defineProperty(globalThis, 'localStorage', { ...previous, configurable: true });
    else delete globalThis.localStorage;
  }
}

test('with no localStorage at all, the store still works in memory', () => {
  withLocalStorage(null, () => {
    store.reset();
    eq(store.persistent, false, 'node has no localStorage, and the store says so');
    eq(store.records, {}, 'a fresh session starts empty');
    eq(store.unlocked, 1);
    const rec = store.solve('mem-01', { presses: 4, par: 4 });
    eq(rec, { solved: true, best: 4, plays: 1, perfect: true });
    eq(store.record('mem-01').best, 4, 'the record is readable for this session');
    eq(store.stats.solves, 1);
  });
});

test('a localStorage that throws on access is a fallback, not a crash', () => {
  // This is the file:// and private-window case: touching the property itself is the throw.
  withLocalStorage({
    get() { throw new Error('SecurityError: storage is denied'); },
  }, () => {
    store.reset();
    eq(store.persistent, false, 'a throwing store is no store');
    const rec = store.solve('throw-01', { presses: 7, par: 5 });
    eq([rec.best, rec.perfect], [7, false], 'and the session still records something true');
    eq(store.unlocked, 1, 'nothing unlocked yet');
    eq(store.unlock(3), 3, 'unlocking works, it just cannot outlive the session');
    eq(store.unlocked, 3);
  });
});

test('a working localStorage gets the save, and reads it back after a reload', () => {
  const fake = fakeStore();
  withLocalStorage({ get: () => fake }, () => {
    store.reset();
    eq(store.persistent, true);
    store.solve('a-01', { presses: 3, par: 3 });
    store.unlock(2);
    ok(fake.map.has(SAVE_KEY), 'the run reached the store, not only memory');
    const raw = JSON.parse(fake.map.get(SAVE_KEY));
    eq(raw.records['a-01'], { solved: true, best: 3, plays: 1, perfect: true });
    eq(raw.unlocked, 2);
    eq(raw.stats.solves, 1);
    // Now simulate a page reload: store.reset() empties the in-process cache, the bytes are
    // put back the way a returning visitor would find them, and the next read must parse
    // them rather than trust what this session remembered.
    store.reset();
    fake.map.set(SAVE_KEY, JSON.stringify(raw));
    const again = store.solve('a-01', { presses: 5, par: 3 });
    eq([again.best, again.plays, again.perfect], [3, 2, true], 'best and perfect survive a reload');
    eq(store.persistent, true);
  });
});

test('a setItem that throws mid-session (quota) is absorbed', () => {
  const fake = fakeStore({ setItem() { throw new Error('QuotaExceededError'); } });
  withLocalStorage({ get: () => fake }, () => {
    store.reset();
    const rec = store.solve('quota-01', { presses: 2, par: 2 });
    eq([rec.best, rec.perfect], [2, true], 'the record exists in memory');
    eq(fake.map.size, 0, 'and nothing was written, which is the point');
    eq(store.record('quota-01').best, 2, 'the session can still read its own numbers');
  });
});

test('best only goes down, perfect is sticky, plays only counts', () => {
  const fake = fakeStore();
  withLocalStorage({ get: () => fake }, () => {
    store.reset();
    eq(store.solve('mono-01', { presses: 9, par: 5 }).best, 9);
    eq(store.solve('mono-01', { presses: 12, par: 5 }).best, 9, 'a worse run cannot move best');
    eq(store.solve('mono-01', { presses: 4, par: 5 }).best, 4, 'a better one can');
    eq(store.solve('mono-01', { presses: 6, par: 5 }).best, 4, 'and never back up');
    const last = store.solve('mono-01', { presses: 5, par: 5 });
    eq([last.plays, last.perfect], [5, true], 'five runs, and the perfect flag set once stays set');
    eq(store.stats.solves, 5);
    eq(store.stats.presses, 9 + 12 + 4 + 6 + 5, 'every press is billed once');
    eq(store.stats.perfect, 2, 'only the runs at or under par count as perfect');
  });
});

test('unlocking is monotone and clearing really clears', () => {
  const fake = fakeStore();
  withLocalStorage({ get: () => fake }, () => {
    store.reset();
    eq(store.unlocked, 1);
    eq(store.unlock(4), 4);
    eq(store.unlock(2), 4, 're-solving an early level cannot lock a later one away');
    eq(store.unlock(4), 4, 'and re-unlocking the same level is a no-op');
    eq(JSON.parse(fake.map.get(SAVE_KEY)).unlocked, 4);
    store.markDaily('2026-09-27', 'd-01');
    eq(store.dailyDone('2026-09-27').id, 'd-01');
    ok(store.dailyDone('2026-09-27').at > 0, 'the daily mark carries a timestamp');
    eq(store.dailyDone('2026-01-01'), null, 'and a day nobody played is not marked');
    store.noteReset();
    eq(store.stats.resets, 1);
    eq(store.reset(), true, 'the wipe reports that it removed the key');
    eq(fake.map.has(SAVE_KEY), false, 'the bytes are gone');
    eq([Object.keys(store.records).length, store.unlocked, store.stats.solves, store.dailyDone('2026-09-27')],
      [0, 1, 0, null], 'and the session starts over');
  });
});

test('a corrupt or alien save is discarded, not trusted', () => {
  const cases = [
    ['{not json', 'truncated write'],
    ['null', 'the literal null'],
    ['[]', 'an array where an object belongs'],
    ['{"records":"nope","unlocked":-3,"daily":7}', 'fields of the wrong types'],
    ['{"records":{"x":{"best":"wide"}},"unlocked":"two"}', 'fields with the wrong values'],
  ];
  for (const [raw, label] of cases) {
    const fake = fakeStore();
    withLocalStorage({ get: () => fake }, () => {
      store.reset();
      // Seed after the reset: reset() clears the cache *and* the bytes, so this is the only
      // order in which the parse path is the thing under test.
      fake.map.set(SAVE_KEY, raw);
      const s = store.records;
      ok(s && typeof s === 'object' && !Array.isArray(s), `${label}: records came back as an object`);
      ok(Number.isInteger(store.unlocked) && store.unlocked >= 1, `${label}: unlocked is a positive integer`);
      eq(store.stats.solves, 0, `${label}: stats are the blank ones`);
      eq(store.solve('after-corrupt', { presses: 3, par: 3 }).best, 3, `${label}: the store still works`);
    });
  }
});

test('a save from a future shape is read as far as it can be', () => {
  const fake = fakeStore();
  const future = JSON.stringify({
    records: { 'old-01': { solved: true, best: 6, plays: 2, perfect: false } },
    unlocked: 5,
    stats: { solves: 2, perfect: 0, presses: 11, resets: 0, hints: 7 },
    daily: { '2026-01-01': { id: 'old-01', at: 1 } },
    someday: { not: 'mine' },
  });
  withLocalStorage({ get: () => fake }, () => {
    store.reset();
    // Seeded after the wipe, exactly the way a returning visitor finds it.
    fake.map.set(SAVE_KEY, future);
    eq(store.record('old-01').best, 6, 'records are kept as found');
    eq(store.unlocked, 5);
    eq(store.stats.hints, 7, 'an unknown stat field is preserved rather than dropped');
    eq(store.dailyDone('2026-01-01').id, 'old-01');
    eq(store.solve('old-01', { presses: 4, par: 5 }).best, 4, 'and the new run improves on it');
    eq(store.someday, undefined, 'a field this build does not know is not promoted to the API');
  });
});

test('the key is versioned, so a shape change cannot be misread', () => {
  eq(SAVE_KEY, 'lightsout.save.v1');
  ok(/\.v\d+$/.test(SAVE_KEY), 'and the version suffix is there to bump');
});

run();
