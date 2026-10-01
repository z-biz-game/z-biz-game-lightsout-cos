// 离线外壳。策略只有一条：同源 GET 一律"网络优先、失败退缓存"。
//
// 为什么不 cache-first：这个仓没有构建步骤，也没有内容哈希文件名（js/main.js 就叫
// js/main.js），cache-first 会把 ES module 永久钉死在第一次装包时的那一版，之后每次
// 发版都会出现"新 HTML 配旧 JS"的鬼状态——而 HTML 里内联的注册代码与 shell 结构是
// 和 js 一起改的，这种错配正好是最容易炸的那一种。网络优先的代价是首屏多一次往返，
// 换来的是"部署即生效"，对一个 4 个 JS 文件的小站是划算的。
//
// cache 名带 VERSION：发版时改这一个常量，activate 里旧版本缓存整批删掉。
const VERSION = 'v1';
const CACHE = `lightsout-${VERSION}`;

// 装包时预热的外壳。缺一个也不报错（下面的 catch 吞掉），因为离线能不能开是次要的，
// 在线时绝不能因为预热失败而卡住 install。
const SHELL = [
  './',
  './index.html',
  './css/game.css',
  './js/main.js',
  './js/view.js',
  './js/core/game.js',
  './js/core/grid.js',
  './js/core/gf2.js',
  './js/core/library.js',
  './js/core/make.js',
  './js/core/rng.js',
  './js/core/solve.js',
  './js/core/storage.js',
  './js/data/lots.js',
  './manifest.webmanifest',
  './art/icons/icon-192.png',
  './art/icons/icon-512.png',
  './art/icons/apple-touch-icon.png',
  './art/textures/plate-grain-256.png',
  './art/sprites/spark-64.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // 跨源的一律不接管：这个站不引任何第三方资源，接管只会带来 CORS 报错。
  if (url.origin !== self.location.origin) return;
  event.respondWith(networkFirst(req, url));
});

async function networkFirst(req, url) {
  let networkError = null;
  try {
    const res = await fetch(req);
    if (res && res.ok && res.type !== 'opaque') {
      const cache = await caches.open(CACHE);
      cache.put(req, res.clone());
      return res;
    }
  } catch (err) {
    networkError = err;
  }
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  // 导航请求离线且没缓存过这一页：退回外壳，让 hash 路由自己去决定进哪一关。
  if (!networkError && req.mode === 'navigate') {
    const shell = await cache.match('./index.html');
    if (shell) return shell;
  }
  if (url.pathname.endsWith('/index.html') || url.pathname.endsWith('/')) {
    const shell = await cache.match('./index.html');
    if (shell) return shell;
  }
  throw networkError || new Error(`offline and not cached: ${url.pathname}`);
}
