/* ============================================================
   金箔ひらひら Service Worker
   - 画面(HTML)は「つながっていれば必ず最新」。切れていればキャッシュ
   - アイコンなどの変わらない物はキャッシュ優先で即表示
   - 更新時はキャッシュ名(バージョン)を変えると古い物を掃除
   ============================================================ */
const CACHE_NAME = "kinpaku-hirahira-v27";

const ASSETS = [
  "./",
  "./index.html",
  "./core.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-512-maskable.png",
  "./apple-touch-icon.png",
  "./title.jpg",
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

/* 画面そのもの(HTML)かどうか */
function isPage(req) {
  return req.mode === "navigate" ||
         (req.headers.get("accept") || "").includes("text/html");
}

/* 取得
   - HTML …ネットワーク優先。取れたら次のオフライン用に焼き直す。
            キャッシュ優先にすると、直して配っても古い画面が出続ける
   - その他…キャッシュ優先(アイコンや manifest は変わらないので速さを取る) */
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  if (isPage(req)) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches.match(req).then((hit) => hit || caches.match("./index.html"))
        )
    );
    return;
  }

  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
