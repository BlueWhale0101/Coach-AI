const SHELL = "assistant-ai-phone-shell-v1";
const ASSETS = [
  "/phone/", "/phone/styles.css", "/phone/phone.mjs", "/phone/dom.mjs", "/phone/load-view.mjs",
  "/phone/view-model.mjs", "/phone/cache.mjs", "/phone/local-projection.mjs",
  "/tablet-board/data-provider.mjs", "/tablet-board/view-helpers.mjs", "/tablet-board/mutation-staging.mjs",
  "/assistant-ui/tokens.css", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png",
];
self.addEventListener("install", event => event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("assistant-ai-phone-shell-") && key !== SHELL).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin || !ASSETS.includes(url.pathname)) return;
  event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request).then(response => {
    const copy = response.clone(); caches.open(SHELL).then(cache => cache.put(event.request, copy)); return response;
  })));
});
