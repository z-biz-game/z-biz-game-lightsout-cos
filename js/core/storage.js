// Save file. One localStorage key, plain JSON, a versioned shape so an old save can be
// recognised rather than mistaken for a new one, and a guarded back end.
//
// The guard matters: window.localStorage is not "undefined when unavailable" — under file://
// and in some private modes *touching the property throws* SecurityError, and setItem can
// throw QuotaExceededError at any time. So every access goes through `backend()`, which
// treats a throw as "no persistent store" and keeps the session in memory. Under node there
// is no localStorage at all, which is what lets test/storage.test.mjs drive the same module.

export const SAVE_KEY = 'lightsout.save.v1';

function blank() {
  return {
    records: {},
    daily: {},
    unlocked: 1,
    stats: { solves: 0, perfect: 0, presses: 0, resets: 0 },
  };
}

let cache = null;

// Re-evaluated on every call on purpose: a browser that throws here (private mode, disabled
// storage) throws consistently, and latching the verdict would let one early failure in a
// test process permanently disable the store for the ones that follow.
function backend() {
  try {
    const ls = globalThis.localStorage;
    if (ls && typeof ls.getItem === 'function' && typeof ls.setItem === 'function') return ls;
  } catch (err) {
    return null;
  }
  return null;
}

// The real back end is the browser's localStorage; both paths are wrapped so that a throw
// is a fallback rather than a crash.
function api(store) {
  return {
    getItem: (k) => store.getItem(k),
    setItem: (k, v) => store.setItem(k, v),
    removeItem: (k) => store.removeItem(k),
  };
}

function current() {
  const ls = backend();
  return ls ? api(ls) : null;
}

function load() {
  if (cache) return cache;
  const store = current();
  let raw = null;
  if (store) {
    try {
      raw = store.getItem(SAVE_KEY);
    } catch (err) {
      raw = null;
    }
  }
  if (raw) {
    try {
      const p = JSON.parse(raw);
      if (p && typeof p === 'object') {
        const base = blank();
        cache = {
          records: p.records && typeof p.records === 'object' ? p.records : base.records,
          daily: p.daily && typeof p.daily === 'object' ? p.daily : base.daily,
          unlocked: Number(p.unlocked) > 0 ? Number(p.unlocked) : base.unlocked,
          stats: { ...base.stats, ...(p.stats || {}) },
        };
        return cache;
      }
    } catch (err) {
      // A corrupt save is not worth keeping; start clean rather than crash the shell.
    }
  }
  cache = blank();
  return cache;
}

function persist() {
  const store = current();
  if (!store) return false;
  try {
    store.setItem(SAVE_KEY, JSON.stringify(cache));
    return true;
  } catch (err) {
    // Quota or SecurityError: the session continues in memory.
    return false;
  }
}

export const store = {
  get records() { return load().records; },
  get stats() { return load().stats; },
  get daily() { return load().daily; },
  get unlocked() { return load().unlocked; },
  get persistent() { return !!current(); },

  record(id) {
    return load().records[id] || null;
  },

  // Unlocking is monotone: clearing a later level must never be able to hide one again.
  unlock(n) {
    const s = load();
    if (n > s.unlocked) s.unlocked = n;
    persist();
    return s.unlocked;
  },

  markDaily(dateKey, id) {
    const s = load();
    s.daily[dateKey] = { id, at: Date.now() };
    persist();
  },

  dailyDone(dateKey) {
    return load().daily[dateKey] || null;
  },

  // `par` is the certified coset minimum, so "perfect" is a fact about the board rather
  // than a feeling: you matched the enumeration.
  solve(id, { presses, par }) {
    const s = load();
    const prev = s.records[id];
    const cur = {
      solved: true,
      best: !prev || !prev.best || presses < prev.best ? presses : prev.best,
      plays: (prev && prev.plays ? prev.plays : 0) + 1,
      perfect: presses <= par || !!(prev && prev.perfect),
    };
    s.records[id] = cur;
    s.stats.solves += 1;
    s.stats.presses += presses;
    if (presses <= par) s.stats.perfect += 1;
    persist();
    return cur;
  },

  noteReset() {
    const s = load();
    s.stats.resets += 1;
    persist();
  },

  reset() {
    // Drop the cache as well as the bytes: the next read must go back to the store, so a
    // wipe behaves exactly like a fresh document instead of a blank in-memory one.
    cache = null;
    const store = current();
    if (!store) return false;
    try {
      store.removeItem(SAVE_KEY);
      return true;
    } catch (err) {
      return false;
    }
  },
};
