const CACHE_NAME = "farbscout-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./registro.html",
  "./recuperar.html",
  "./onboarding.html",
  "./scanner.html",
  "./perfil.html",
  "./css/base.css",
  "./css/login.css",
  "./css/app.css",
  "./js/app.js",
  "./assets/FARBSCOUT_LOGO.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  // No interceptar peticiones a Firebase ni a Gemini API
  if (e.request.url.includes("googleapis.com") || e.request.url.includes("gstatic.com")) {
    return;
  }
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}