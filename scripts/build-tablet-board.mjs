import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const dist = resolve(root, "dist");
const server = resolve(dist, "server");

const assets = {
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
};

const worker = `const ASSETS = ${JSON.stringify(assets)};

const ROUTES = {
  "/api/household-board": "get-household-board",
  "/api/object-decorations": "get-object-decorations",
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
  return new Response(item.body, {
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
    if (url.pathname.startsWith("/tablet-board/")) return asset("/tablet-board/");
    return new Response("Not found", { status: 404 });
  },
};
`;

await rm(dist, { recursive: true, force: true });
await mkdir(server, { recursive: true });
await writeFile(resolve(server, "index.js"), worker);
await writeFile(resolve(dist, ".openai-hosting-kind"), "worker\n");
