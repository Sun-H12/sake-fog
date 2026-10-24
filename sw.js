// 静的ファイルを更新する際は、このバージョンも更新する。
const CACHE_VERSION = 'v15';
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
  'icons/icon-192-v2.png',
  'icons/icon-512-v2.png',
  'icons/icon-maskable-512-v3.png',
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
    // 安全確認と利用者の許可がある場合だけ、messageイベントから即時適用する。
  })());
});

let applyingUpdate = false;
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'APPLY_UPDATE' || !event.ports[0]) return;
  const port = event.ports[0];
  event.waitUntil((async () => {
    const block = (reason = 'unsafe') => port.postMessage({ type: 'UPDATE_BLOCKED', reason });
    if (applyingUpdate) { block(); return; }
    applyingUpdate = true;
    try {
      // 待機workerには制御中の画面がないため、旧worker配下の画面も含める。
      const onlyRequester = async () => {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const scope = new URL(self.registration.scope);
        const related = windows.filter((client) => {
          const url = new URL(client.url);
          return url.origin === scope.origin && url.pathname.startsWith(scope.pathname);
        });
        if (related.length !== 1) return 'other-clients';
        const client = related[0];
        if (!event.source || client.id !== event.source.id || client.visibilityState !== 'visible') return 'unsafe';
        return '';
      };
      let reason = await onlyRequester();
      if (reason) { block(reason); return; }
      const isWaiting = () => self.registration.waiting?.state === 'installed'
        && self.registration.waiting.scriptURL === self.location.href;
      if (!isWaiting() || !self.registration.active) { block(); return; }
      const ready = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), 4000);
        port.onmessage = ({ data }) => {
          clearTimeout(timer);
          resolve(data?.type === 'UPDATE_READY');
        };
        port.postMessage({ type: 'UPDATE_CONFIRM' });
      });
      if (!ready) { block(); return; }
      reason = await onlyRequester();
      if (reason) { block(reason); return; }
      if (!isWaiting()) { block(); return; }
      await self.skipWaiting();
    } catch { block(); }
    finally { applyingUpdate = false; port.close(); }
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
