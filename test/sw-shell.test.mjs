// The offline shell, re-measured. sw.js is a hand-typed list, and a hand-typed list goes stale
// the moment someone adds a module: js/audio.js and js/clock.js were both missing from v1, and
// because they are `import`ed by js/main.js, "service worker installed, then the network drops"
// used to be a white screen rather than a playable offline game. This suite reads the real entry
// graph off disk, so the list cannot drift again without a red row here.
//
// The same file also certifies the bitmap claims: every PNG the page or the manifest points at
// must exist and must decode to the size it advertises. "art/ exists" is not evidence; the IHDR
// is.

import { test, run, ok, eq } from '../tools/harness.mjs';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// sw.js is a service worker, not an ES module — `import`ing it would need a worker shim, and
// the registration itself is not what is being certified here. So the array is parsed, and the
// parse is guarded: if the shape ever changes, this fails instead of silently reading [].
function shellList() {
  const src = read('sw.js');
  const block = /const SHELL = \[([\s\S]*?)\];/.exec(src);
  ok(block, 'sw.js still declares `const SHELL = [...]`');
  const entries = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  ok(entries.length > 0, 'the shell is not empty');
  return entries;
}

// Transitive closure of relative `import` specifiers, resolved the way a browser would.
function moduleClosure(entry) {
  const seen = new Set();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    ok(existsSync(join(ROOT, file)), `${file} is referenced but not on disk`);
    seen.add(file);
    const src = read(file);
    for (const m of src.matchAll(/from\s+'([^']+)'/g)) {
      const spec = m[1];
      if (!spec.startsWith('.')) continue; // no bare specifiers: this repo has zero dependencies
      stack.push(normalize(join(dirname(file), spec)));
    }
  }
  return seen;
}

// PNG IHDR: signature, then width/height as two big-endian u32 at byte 16.
function pngSize(rel) {
  const buf = readFileSync(join(ROOT, rel));
  eq([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${rel} is not a PNG`);
  ok(buf.length > 100, `${rel} is too small to be a real picture (${buf.length} bytes)`);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), bytes: buf.length };
}

const shell = shellList();
const shellPaths = new Set(shell.map((s) => normalize(s.replace(/^\.\//, ''))));

test('the offline shell pre-warms the whole entry module graph', () => {
  const closure = moduleClosure('js/main.js');
  const missing = [...closure].filter((f) => !shellPaths.has(f)).sort();
  eq(missing, [], `offline first load would break on: ${missing.join(', ')}`);
  ok(closure.size >= 12, `the entry graph should be the shipped one, got ${closure.size} modules`);
});

test('every local file index.html links is on disk and in the shell', () => {
  const html = read('index.html');
  const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((r) => !/^(https?:|#|data:)/.test(r))
    .map((r) => normalize(r.replace(/^\.\//, '').split(/[?#]/)[0]))
    .filter((r) => /\.(png|ico|css|js|webmanifest)$/.test(r));
  const absent = refs.filter((r) => !existsSync(join(ROOT, r))).sort();
  eq(absent, [], 'index.html points at files that are not on disk');
  // js/main.js carries a `?v=`-free src and is in the closure; the inline SW registration is not
  // a file, so every local reference the page actually downloads has to be in the shell.
  const unshelled = [...new Set(refs)].filter((r) => !shellPaths.has(r)).sort();
  eq(unshelled, [], `these are fetched by the page but never pre-warmed: ${unshelled.join(', ')}`);
});

test('the manifest advertises icon sizes the PNGs actually have', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2, 'the manifest must ship icons');
  const has512 = [];
  for (const icon of manifest.icons) {
    const rel = normalize(icon.src.replace(/^\.\//, ''));
    ok(existsSync(join(ROOT, rel)), `${icon.src} is in the manifest but not on disk`);
    const { w, h } = pngSize(rel);
    eq(icon.sizes, `${w}x${h}`, `${icon.src} claims ${icon.sizes} but its IHDR says ${w}x${h}`);
    if (w >= 512) has512.push(icon.purpose || 'any');
  }
  ok(has512.length >= 1, 'a installable PWA needs a >=512px icon');
  for (const key of ['name', 'short_name', 'start_url', 'display', 'theme_color', 'background_color']) {
    ok(manifest[key], `manifest is missing ${key}`);
  }
});

test('the two in-game bitmaps the view loads really exist', () => {
  const view = read('js/view.js');
  const srcs = [...view.matchAll(/\.src = '([^']+)'/g)].map((m) => normalize(m[1]));
  eq(srcs.length, 2, 'the view is supposed to load exactly the grain and the spark');
  for (const rel of srcs) {
    ok(existsSync(join(ROOT, rel)), `${rel} missing`);
    const { bytes } = pngSize(rel);
    ok(bytes > 1000, `${rel} should be a painted texture, not a stub (${bytes} bytes)`);
    ok(shellPaths.has(rel), `${rel} is drawn by the game but not pre-warmed for offline`);
  }
});

test('the icon the store listing and the social card use are real pictures', () => {
  const touch = pngSize('art/icons/apple-touch-icon.png');
  ok(touch.w >= 180 && touch.h >= 180, `apple-touch-icon is ${touch.w}x${touch.h}, needs >=180`);
  const og = pngSize('art/og.png');
  eq([og.w, og.h], [1200, 630], 'the social card is 1200x630 or the markup lies about it');
  const html = read('index.html');
  ok(/og:image" content="art\/og\.png"/.test(html), 'index.html still points og:image at the card');
  ok(/og:image:width" content="1200"/.test(html) && /og:image:height" content="630"/.test(html),
    'the declared card dimensions match the file');
});

test('the sw keeps one VERSION-derived cache name and a network-first fetch path', () => {
  const src = read('sw.js');
  const version = /const VERSION = '([^']+)'/.exec(src);
  ok(version, 'sw.js declares VERSION');
  eq(version[1], 'v2', 'the shell content changed, so the cache name had to change with it');
  ok(/^lightsout-\$\{VERSION\}$/.test(/const CACHE = `([^`]+)`/.exec(src)[1]),
    'the cache name is derived from VERSION, not typed twice');
  ok(/event\.respondWith\(networkFirst\(req, url\)\)/.test(src), 'the fetch handler goes through networkFirst');
  const html = read('index.html');
  ok(/location\.protocol === 'http:' \|\| location\.protocol === 'https:'/.test(html),
    'SW registration is skipped under file:// instead of throwing');
});

run();
