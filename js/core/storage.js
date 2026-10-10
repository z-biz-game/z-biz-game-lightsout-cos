// Save file. One localStorage key, plain JSON, a versioned shape so an old save can be
// recognised rather than mistaken for a new one, and a guarded back end.
//
// The guard matters: window.localStorage is not "undefined when unavailable" — under file://
// and in some private modes *touching the property throws* SecurityError, and setItem can
// throw QuotaExceededError at any time. So every access goes through `backend()`, which
// treats a throw as "no persistent store" and keeps the session in memory. Under node there
// is no localStorage at all, which is what lets test/storage.test.mjs drive the same module.
//
// Decoding is two-stage on purpose, and the two stages fail differently:
//   stage 1 — parse. A save that is not JSON at all is a corrupt file; there is nothing to
//             keep, so it becomes a blank save.
//   stage 2 — validate, one entry at a time. A single bad record (someone hand-edited it, an
//             older build wrote a different shape, a bookmarklet put nonsense under the key)
//             must cost that one record and nothing else. The first version of this module did
//             `Object.assign(blank(), JSON.parse(raw))`, which meant one `null` record threw in
//             the middle of a getter and the whole shell rendered as an empty board — the save
//             file became a way to lose the game.

export const SAVE_KEY = 'lightsout.save.v1';
// 存档格式版本号。写档带上、读档校验：将来改形状时旧档宁可整档丢弃，也不能被误读。
export const SAVE_VERSION = 1;

function blank() {
  return {
    v: SAVE_VERSION,
    records: {},
    daily: {},
    settings: {},
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

// The real back end is the browser's localStorage. The three operations call the facade
// directly — `globalThis.localStorage.getItem(...)`, not a captured reference — because the
// property access is the thing a denying browser throws on, and a read-back has to mean "what
// the browser actually holds right now", not "what this module remembered holding earlier".
function api() {
  return {
    getItem: (k) => globalThis.localStorage.getItem(k),
    setItem: (k, v) => globalThis.localStorage.setItem(k, v),
    removeItem: (k) => globalThis.localStorage.removeItem(k),
  };
}

function current() {
  return backend() ? api() : null;
}

// ---- stage 2 validators ----------------------------------------------------

function plainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function count(value, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(max, Math.floor(n));
}

// One record: `best` has to be a real press count and `plays` a real number of runs, because
// both are printed as numbers and `best` is compared against the certified par. Anything else
// is dropped — by the record, not by the file.
function decodeRecord(raw) {
  if (!plainObject(raw)) return null;
  const best = count(raw.best);
  if (best === null || best < 1) return null;
  const plays = count(raw.plays);
  if (plays === null) return null;
  const out = {
    solved: raw.solved === false ? false : true,
    best,
    plays: Math.max(1, plays),
    perfect: !!raw.perfect,
  };
  const seconds = count(raw.seconds);
  if (seconds !== null) out.seconds = seconds;
  return out;
}

function decodeDailyEntry(raw) {
  if (typeof raw === 'string') return raw ? { id: raw, at: 0 } : null;
  if (!plainObject(raw)) return null;
  if (typeof raw.id !== 'string' || !raw.id) return null;
  const at = count(raw.at);
  return { id: raw.id, at: at === null ? 0 : at };
}

function decodeRecords(raw) {
  const out = {};
  if (!plainObject(raw)) return out;
  for (const key of Object.keys(raw)) {
    const rec = decodeRecord(raw[key]);
    if (rec) out[key] = rec;
  }
  return out;
}

function decodeDaily(raw) {
  const out = {};
  if (!plainObject(raw)) return out;
  for (const key of Object.keys(raw)) {
    const day = decodeDailyEntry(raw[key]);
    if (day) out[key] = day;
  }
  return out;
}

function decodeStats(raw) {
  const base = blank().stats;
  if (!plainObject(raw)) return base;
  // Unknown fields ride along: a future build's counter must not be erased by an older one
  // reading the file, which is the whole point of the "future shape" test.
  const out = { ...base, ...raw };
  for (const key of Object.keys(base)) {
    const n = count(raw[key]);
    out[key] = n === null ? base[key] : n;
  }
  for (const key of Object.keys(out)) {
    if (!Number.isFinite(Number(out[key])) || Number(out[key]) < 0) delete out[key];
  }
  return out;
}

function decodeSettings(raw) {
  const out = {};
  if (!plainObject(raw)) return out;
  if (typeof raw.muted === 'boolean') out.muted = raw.muted;
  if (typeof raw.helpSeen === 'boolean') out.helpSeen = raw.helpSeen;
  return out;
}

function decode(parsed) {
  if (!plainObject(parsed)) return blank();
  const unlocked = count(parsed.unlocked);
  return {
    records: decodeRecords(parsed.records),
    daily: decodeDaily(parsed.daily),
    settings: decodeSettings(parsed.settings),
    unlocked: unlocked === null || unlocked < 1 ? 1 : Math.max(1, Math.floor(unlocked)),
    stats: decodeStats(parsed.stats),
  };
}

// 数字字段的归一自带一份，不依赖仓里有没有 count() —— 少一层隐式耦合。
function recordNum(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// 存档两段式解码的第一段：整档 JSON 落到这里之后，**逐字段**归一。
// 一条记录不是"能用/不能用"二选一 —— 类型错的字段自己退成默认值，整条照样留下。
// 第二段（sanitizeRecords）在下面：它只丢掉归一后彻底没意义的记录，别的记录不受牵连。
function sanitizeRecord(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const out = {};
  out.solved = !!r.solved;
  out.best = recordNum(r.best);
  out.plays = recordNum(r.plays);
  out.perfect = !!r.perfect;
  return out;
}

// 逐条隔离：坏的那条丢掉，好的那些原样留下，绝不因为一条把整份存档作废。
function sanitizeRecords(p) {
  const out = {};
  if (!p || typeof p !== 'object' || Array.isArray(p)) return out;
  for (const [id, rec] of Object.entries(p)) {
    const clean = sanitizeRecord(rec);
    if (clean) out[id] = clean;
  }
  return out;
}

function load() {
  if (cache) return cache;
  const store = current();
  let raw = null;
  if (store) {
    try {
      raw = globalThis.localStorage.getItem(SAVE_KEY);
    } catch (err) {
      raw = null;
    }
  }
  if (raw) {
    try {
      const p = JSON.parse(raw);
      // 版本门：只认本仓写出去的版本。将来升 v2 时，旧档宁可整档丢弃也不能被误读成新档。
      if (p && typeof p === 'object' && !Array.isArray(p)
          && (p.v === undefined || p.v === SAVE_VERSION)) {
        const base = blank();
        cache = {
          records: sanitizeRecords(p.records),
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
    globalThis.localStorage.setItem(SAVE_KEY, JSON.stringify(cache));
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
  get settings() { return load().settings; },
  get unlocked() { return load().unlocked; },
  get persistent() { return !!current(); },
  // 盘上现在到底有没有这些字节：写完读回来自检，清空之后也用它确认真的没了，
  // 而不是相信本进程的缓存。浏览器拒绝存储时返回 null，不返回假数据。
  rawBytes() {
    const s = current();
    if (!s) return null;
    try {
      return s.getItem(SAVE_KEY);
    } catch (err) {
      return null;
    }
  },

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
  // than a feeling: you matched the enumeration. `seconds` is the frozen session clock at
  // the moment the board went dark, and only ever goes down alongside `best`.
  solve(id, { presses, par, seconds }) {
    const s = load();
    const prev = decodeRecord(s.records[id]) || null;
    const cur = {
      solved: true,
      best: !prev || !prev.best || presses < prev.best ? presses : prev.best,
      plays: (prev && prev.plays ? prev.plays : 0) + 1,
      perfect: presses <= par || !!(prev && prev.perfect),
    };
    const took = count(seconds);
    if (took !== null) {
      // 用时跟着最好那一局：这一趟按得更多，就不拿它覆盖纪录的时间。
      const keepsPrev = prev && prev.seconds !== undefined && presses > prev.best;
      cur.seconds = keepsPrev ? prev.seconds : took;
    }
    s.records[id] = cur;
    s.stats.solves += 1;
    s.stats.presses += presses;
    if (presses <= par) s.stats.perfect += 1;
    persist();
    return cur;
  },

  setSetting(key, value) {
    const s = load();
    s.settings[key] = value;
    persist();
    return value;
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
