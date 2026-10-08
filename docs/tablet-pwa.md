# Install the Assistant.AI tablet app

After this PR is merged and the existing Site is republished, open Android Chrome at:

https://assistant-tablet-board-v0.iona-skye-eller.chatgpt.site/tablet-board/

1. Visit online once and let the Board finish loading.
2. Open Chrome's menu and choose **Install app** (or **Add to Home screen**, then **Install**, depending on Chrome version).
3. Open **Assistant Board** from the home screen/app launcher.
4. Verify it opens directly on the Board, without tabs/address bars, with the existing Assistant icon. Landscape is requested where supported.

## Hosting and installation boundaries

Keep the existing OpenAI Site and production runtime environment. Run `node scripts/build-tablet-board.mjs` when packaging; it includes the tablet manifest, scoped service worker, shared CSS, and existing PNG icons in the same worker asset map. No new runtime variables, backend endpoints, or hosting configuration are required. HTTPS and same-origin delivery are supplied by the existing Site. The service worker lives under `/tablet-board/`, so no broadened Service-Worker-Allowed header is necessary.

The tablet manifest has explicit identity, start URL, and scope `/tablet-board/`. The phone manifest, start URL `/phone/`, and `/phone/sw.js` registration are unchanged. They remain separate installations on the same origin.

## Offline shell and updates

After a successful initial online visit and service-worker installation, tablet HTML, JS, CSS, manifest, and icons are available offline. Supported tablet navigation routes fall back to the canonical cached HTML while retaining the original URL/query. Public shell assets use network first with cache fallback. The build hashes shell contents into the tablet cache version. Updates activate after older controlled sessions close; close/reopen the installed app after deployment. Only old tablet caches are removed; phone caches are preserved.

No authenticated API responses or mutations are cached by this worker. Household data still uses the existing same-origin Projection/API boundary and requires connectivity. Offline shell availability does **not** mean offline household data or queued writes; existing connection errors may appear. No new data store or synchronization engine is added.

## Manual acceptance after authorized deployment

Automated tests exercise manifest/asset delivery, PNG dimensions, route/query handling, offline shell fallback, network refresh, cache isolation, and API bypass. Physical Android installation and orientation behavior still require verification:

- Install and launch at the production URL; verify name/icon, standalone mode, landscape preference, and Board start URL.
- At 1024×768 and 1080×810-class usable areas, expand a long task; verify independent task/calendar scrolling, contained buttons, divider/settings, and no document overflow.
- Exercise navigation, completion/Undo, calendar details, and the existing five-minute refresh online.
- Visit each view online, close/reopen with airplane mode: shell assets should load; household data remains network-dependent. Disable airplane mode and verify refresh recovery.
- Verify a separately installed phone app still launches `/phone/` and keeps its existing offline behavior.
- Republish an update, close all tablet windows, reopen, and verify the updated shell and isolated cache cleanup.

Chrome references: https://developer.chrome.com/docs/capabilities/pwa-manifest-id and https://developer.chrome.com/docs/devtools/progressive-web-apps
