// Only the public application shell is cached. API reads/writes remain untouched.
const PREFIX = "assistant-ai-tablet-shell-";
const SHELL = `${PREFIX}__TABLET_SHELL_VERSION__`;
const ASSETS = [
  "/tablet-board/", "/tablet-board/index.html", "/tablet-board/styles.css",
  "/tablet-board/board.mjs", "/tablet-board/calendar-layout.mjs",
  "/tablet-board/data-provider.mjs", "/tablet-board/display-settings.mjs",
  "/tablet-board/mutation-staging.mjs", "/tablet-board/view-helpers.mjs",
  "/tablet-board/manifest.webmanifest", "/assistant-ui/tokens.css",
  "/icons/icon-192.png", "/icons/icon-512.png",
];
const PAGES = ["/tablet-board/", "/tablet-board/index.html", "/tablet-board/tasks", "/tablet-board/calendar", "/tablet-board/knowledge"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(ASSETS)));
});
// Allow an existing session to finish on its current shell before activating updates.
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith(PREFIX) && key !== SHELL).map(key => caches.delete(key)),
  )).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  const pathname = url.pathname.replace(/\/$/, "");
  const page = pathname === "/tablet-board" ? "/tablet-board/" : pathname;
  const navigation = request.mode === "navigate" && PAGES.includes(page);
  // Never treat a missing asset/API route as HTML or cache query-dependent responses.
  if (!navigation && (!ASSETS.includes(url.pathname) || url.search)) return;
  const key = navigation ? "/tablet-board/" : url.pathname;
  event.respondWith((async () => {
    const cache = await caches.open(SHELL);
    // Installation preloads this version's complete public shell. Cache hits
    // return immediately; updates arrive through the service-worker lifecycle.
    const cached = await cache.match(key);
    if (cached) return cached;
    // A missing/evicted entry can still load online. Do not delay delivery with
    // redundant cache writes or mix a newer deployment into this shell cache.
    return fetch(request);
  })());
});
