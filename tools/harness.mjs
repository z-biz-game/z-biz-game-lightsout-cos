// Tiny zero-dep test harness: every test/*.test.mjs suite prints the same shape so
// tools/verify.sh can aggregate them, and so `node --test test/` reads the totals too.
//
// Two numbers are reported on purpose. `rows` is how many named checks ran; `asserts` is
// how many individual conditions were pinned (ok/eq calls). A suite of ten rows with one
// assertion each is not ten checks, and the repo's test floor is stated in assertions.

const rows = [];
let asserts = 0;

export function test(name, fn) {
  try {
    fn();
    rows.push({ test: name, pass: true });
  } catch (err) {
    rows.push({ test: name, pass: false, detail: String((err && err.message) || err) });
  }
}

export function ok(cond, msg = 'expected truthy') {
  asserts++;
  if (!cond) throw new Error(msg);
}

// Boards and press sets are BigInts, which JSON.stringify refuses; render them as `123n` so
// a failure message shows what actually differed.
const show = (v) => JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? `${x}n` : x));

export function eq(a, b, msg = 'not equal') {
  asserts++;
  const sa = show(a);
  const sb = show(b);
  if (sa !== sb) throw new Error(`${msg}\n    got      ${sa}\n    expected ${sb}`);
}

export function fail(msg) {
  asserts++;
  throw new Error(msg);
}

export function run() {
  const bad = rows.filter((r) => !r.pass);
  for (const r of rows) console.log(`${r.pass ? '  ok  ' : '  FAIL'} ${r.test}${r.pass ? '' : '\n         ' + r.detail}`);
  console.log(`asserts: ${asserts}`);
  console.log(`rows: ${rows.length} fail: ${bad.length}`);
  process.exit(bad.length ? 1 : 0);
}
