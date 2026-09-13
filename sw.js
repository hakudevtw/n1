/* データは毎日入れ替わるので、オンラインなら必ず新しいものを取りに行く。
   キャッシュは「電車がトンネルに入ったとき」のための保険であって、
   既定の配信元ではない。CACHE はデプロイのたびに上げる。 */
const CACHE = "moritan-v9";
const BUILD = "v9";

const ASSETS = [
  "./", "index.html",
  "css/app.css",
  "js/app.js", "js/data/words.js", "js/data/grammar.js",
  "manifest.webmanifest",
  "icons/icon-32.png", "icons/icon-180.png", "icons/icon-192.png",
  "icons/icon-512.png", "icons/icon-maskable-512.png"
];

/* 変わらないもの＝アイコンとフォント。これだけはキャッシュ優先でいい。 */
const IMMUTABLE = /\/icons\/|fonts\.(googleapis|gstatic)\.com/;

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* ページから「今すぐ入れ替わって」と言われたとき用 */
self.addEventListener("message", e => {
  if (e.data === "skip-waiting") self.skipWaiting();
  if (e.data === "build") e.source.postMessage({ build: BUILD });
});

function put(req, res) {
  if (res && res.status === 200 && res.type !== "opaque") {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(req, copy));
  }
  return res;
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;
  if (!sameOrigin && !/fonts\.(googleapis|gstatic)\.com/.test(url.hostname)) return;

  // アイコンとフォントは変わらないのでキャッシュ優先
  if (IMMUTABLE.test(url.href)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => put(req, r))));
    return;
  }

  // それ以外はネットワーク優先。3秒で諦めてキャッシュに落ちる（トンネル対策）
  e.respondWith(
    new Promise(resolve => {
      let settled = false;
      const done = r => { if (!settled) { settled = true; resolve(r); } };
      const timer = setTimeout(() => {
        caches.match(req).then(hit => { if (hit) done(hit); });
      }, 3000);

      fetch(req)
        .then(r => { clearTimeout(timer); done(put(req, r)); })
        .catch(() => {
          clearTimeout(timer);
          caches.match(req).then(hit => done(hit || Response.error()));
        });
    })
  );
});
