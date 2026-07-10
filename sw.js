/* ============================================================
   金箔ひらひら Service Worker
   - インストール時に全ファイルをキャッシュしてオフライン対応
   - 更新時はキャッシュ名(バージョン)を変えると古い物を掃除
   ============================================================ */
const CACHE_NAME = "kinpaku-hirahira-v1";

const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png",
];

/* インストール:必要なファイルを先読みキャッシュ */
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

/* 有効化:旧バージョンのキャッシュを削除 */
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* 取得:キャッシュ優先、なければネットワークへ */
self.addEventListener("fetch", (e) => {
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request))
  );
});
