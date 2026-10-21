// 静的ファイルを更新する際は、このバージョンも更新する。
const CACHE_VERSION = 'v3';
// 同一オリジンの別アプリや、別の配置先のキャッシュを削除しない。
const CACHE_PREFIX = `sake-fog-static-${encodeURIComponent(self.registration.scope)}-`;
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
const APP_FILES = [
  'index.html',
  'style.css',
  'script.js',
  'db.js',
  'backup.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];
const APP_URLS = APP_FILES.map((file) => new URL(file, self.registration.scope).href);
const APP_URL_SET = new Set(APP_URLS);
const APP_ROOT = new URL('./', self.registration.scope).href;
const INDEX_URL = new URL('index.html', self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_URLS.map((url) => new Request(url, { cache: 'reload' })));
    // 更新は既存のアプリ画面がすべて閉じられるまで待つ。
    // skipWaitingや自動リロードで、操作中の画面を切り替えない。
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // 一覧の入口（/ または index.html）のナビゲーションだけ同じHTMLに対応させる。
  const navigationUrl = new URL(url);
  navigationUrl.search = '';
  const isAppNavigation = request.mode === 'navigate'
    && (navigationUrl.href === APP_ROOT || navigationUrl.href === INDEX_URL);
  const cacheKey = isAppNavigation ? INDEX_URL : url.href;
  if (!APP_URL_SET.has(cacheKey)) return;

  // キャッシュ対象は固定の9ファイルだけ。API、外部通信、写真Blob等には介入しない。
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(cacheKey);
    return cached || fetch(request);
  })());
});
