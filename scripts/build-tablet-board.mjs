import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const dist = resolve(root, "dist");
const server = resolve(dist, "server");

const binaryAsset = async (path, type) => ({ type, body: (await readFile(resolve(root, path))).toString("base64"), encoding: "base64" });

const assets = {
  "/manifest.webmanifest": { type: "application/manifest+json; charset=utf-8", body: await readFile(resolve(root, "manifest.webmanifest"), "utf8") },
  "/icons/icon-32.png": await binaryAsset("icons/icon-32.png", "image/png"),
  "/icons/icon-192.png": await binaryAsset("icons/icon-192.png", "image/png"),
  "/icons/icon-512.png": await binaryAsset("icons/icon-512.png", "image/png"),
  "/tablet-board/": {
    type: "text/html; charset=utf-8",
    body: await readFile(resolve(root, "tablet-board/index.html"), "utf8"),
  },
  "/tablet-board/index.html": {
    type: "text/html; charset=utf-8",
    body: await readFile(resolve(root, "tablet-board/index.html"), "utf8"),
  },
  "/tablet-board/styles.css": {
    type: "text/css; charset=utf-8",
    body: await readFile(resolve(root, "tablet-board/styles.css"), "utf8"),
  },
  "/tablet-board/board.mjs": {
    type: "text/javascript; charset=utf-8",
    body: await readFile(resolve(root, "tablet-board/board.mjs"), "utf8"),
  },
  "/tablet-board/calendar-layout.mjs": {
    type: "text/javascript; charset=utf-8",
    body: await readFile(resolve(root, "tablet-board/calendar-layout.mjs"), "utf8"),
  },
  "/tablet-board/data-provider.mjs": {
    type: "text/javascript; charset=utf-8",
    body: await readFile(resolve(root, "tablet-board/data-provider.mjs"), "utf8"),
  },
  "/tablet-board/display-settings.mjs": {
    type: "text/javascript; charset=utf-8",
    body: await readFile(resolve(root, "tablet-board/display-settings.mjs"), "utf8"),
  },
  "/tablet-board/mutation-staging.mjs": {
    type: "text/javascript; charset=utf-8",
    body: await readFile(resolve(root, "tablet-board/mutation-staging.mjs"), "utf8"),
  },
  "/tablet-board/view-helpers.mjs": {
    type: "text/javascript; charset=utf-8",
    body: await readFile(resolve(root, "tablet-board/view-helpers.mjs"), "utf8"),
  },
  "/phone/": { type: "text/html; charset=utf-8", body: await readFile(resolve(root, "phone/index.html"), "utf8") },
  "/phone/index.html": { type: "text/html; charset=utf-8", body: await readFile(resolve(root, "phone/index.html"), "utf8") },
  "/phone/styles.css": { type: "text/css; charset=utf-8", body: await readFile(resolve(root, "phone/styles.css"), "utf8") },
  "/phone/phone.mjs": { type: "text/javascript; charset=utf-8", body: await readFile(resolve(root, "phone/phone.mjs"), "utf8") },
  "/phone/dom.mjs": { type: "text/javascript; charset=utf-8", body: await readFile(resolve(root, "phone/dom.mjs"), "utf8") },
  "/phone/load-view.mjs": { type: "text/javascript; charset=utf-8", body: await readFile(resolve(root, "phone/load-view.mjs"), "utf8") },
  "/phone/view-model.mjs": { type: "text/javascript; charset=utf-8", body: await readFile(resolve(root, "phone/view-model.mjs"), "utf8") },
  "/phone/cache.mjs": { type: "text/javascript; charset=utf-8", body: await readFile(resolve(root, "phone/cache.mjs"), "utf8") },
  "/phone/local-projection.mjs": { type: "text/javascript; charset=utf-8", body: await readFile(resolve(root, "phone/local-projection.mjs"), "utf8") },
  "/phone/sw.js": { type: "text/javascript; charset=utf-8", body: await readFile(resolve(root, "phone/sw.js"), "utf8") },
  "/assistant-ui/tokens.css": { type: "text/css; charset=utf-8", body: await readFile(resolve(root, "assistant-ui/tokens.css"), "utf8") },
};

const worker = `const ASSETS = ${JSON.stringify(assets)};

const ROUTES = {
  "/api/household-board": "get-household-board",
  "/api/phone-today": "get-phone-today",
  "/api/object-decorations": "get-object-decorations",
  "/api/category-view": "get-category-view",
  "/api/tagged-tasks": "get-tagged-tasks",
  "/api/complete-task": "complete-task",
  "/api/update-task": "update-task",
  "/api/cancel-task": "cancel-task",
  "/api/list-tasks": "list-tasks",
  "/api/search-tasks": "search-tasks",
  "/api/list-schedule-events": "list-schedule-events",
  "/api/update-schedule-event": "update-schedule-event",
  "/api/cancel-schedule-event": "cancel-schedule-event",
  "/api/list-knowledge": "list-knowledge",
  "/api/search-knowledge": "search-knowledge",
  "/api/update-knowledge": "update-knowledge",
  "/api/archive-knowledge": "archive-knowledge",
  "/api/list-categories": "list-categories",
  "/api/list-tags": "list-tags",
  "/api/get-object-classification": "get-object-classification",
  "/api/pin-object": "pin-object",
  "/api/unpin-object": "unpin-object",
  "/api/is-object-pinned": "is-object-pinned",
};

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors },
  });
}

function asset(pathname) {
  const key = pathname === "/" ? "/tablet-board/" : pathname;
  const item = ASSETS[key];
  if (!item) return null;
  const body = item.encoding === "base64"
    ? Uint8Array.from(atob(item.body), character => character.charCodeAt(0))
    : item.body;
  return new Response(body, {
    headers: {
      "content-type": item.type,
      "cache-control": "no-store",
    },
  });
}

async function proxy(request, env, functionName) {
  if (request.method === "OPTIONS") return json({ ok: true });
  if (request.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED", error: "Method not allowed", details: {} }, 405);

  const baseUrl = env.ASSISTANT_SUPABASE_FUNCTIONS_URL;
  const secret = env.ASSISTANT_ACTION_API_SECRET;
  if (!baseUrl || !secret) {
    return json({ ok: false, code: "SERVER_CONFIG_ERROR", error: "Assistant production connection is not configured for this Site.", details: {} }, 503);
  }

  const upstream = await fetch(\`\${baseUrl.replace(/\\/$/, "")}/\${functionName}\`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-action-secret": secret,
    },
    body: await request.text(),
  });
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: { "content-type": "application/json", ...cors },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const functionName = ROUTES[url.pathname];
    if (functionName) return proxy(request, env, functionName);
    if (url.pathname === "/") {
      const target = new URL("/tablet-board/", url);
      target.search = url.search;
      return Response.redirect(target, 308);
    }
    const found = asset(url.pathname);
    if (found) return found;
    if (url.pathname === "/tablet-board") return Response.redirect(new URL("/tablet-board/", url), 308);
    if (url.pathname === "/phone") {
      const target = new URL("/phone/", url);
      target.search = url.search;
      return Response.redirect(target, 308);
    }
    if (url.pathname.startsWith("/phone/")) return asset("/phone/");
    if (url.pathname.startsWith("/tablet-board/")) return asset("/tablet-board/");
    return new Response("Not found", { status: 404 });
  },
};
`;

await rm(dist, { recursive: true, force: true });
await mkdir(server, { recursive: true });
await writeFile(resolve(server, "index.js"), worker);
await writeFile(resolve(dist, ".openai-hosting-kind"), "worker\n");
