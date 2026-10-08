import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

function workerHarness(source) {
  const handlers = {};
  const stores = new Map();
  const cache = name => {
    if (!stores.has(name)) stores.set(name, new Map());
    const entries = stores.get(name);
    return { addAll: async paths => { for (const path of paths) entries.set(path, new Response(path)); },
      match: async key => entries.get(key)?.clone(), put: async (key, value) => entries.set(key, value) };
  };
  const context = {
    URL, self: { location: { origin: "https://assistant.test" }, clients: { claim: async () => {} }, addEventListener: (type, fn) => { handlers[type] = fn; } },
    caches: { open: async name => cache(name), keys: async () => [...stores.keys()], delete: async name => stores.delete(name) },
    fetch: async () => { throw new Error("offline"); },
  };
  vm.runInNewContext(source, context);
  return { handlers, stores, context, cache };
}

test("tablet manifest and built Site serve branded shell assets and preserve phone routes", async () => {
  execFileSync(process.execPath, ["scripts/build-tablet-board.mjs"], { cwd: root });
  const source = await read("dist/server/index.js");
  const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  const get = path => worker.fetch(new Request(`https://assistant.test${path}`), {});
  const response = await get("/tablet-board/manifest.webmanifest");
  assert.match(response.headers.get("content-type"), /application\/manifest\+json/);
  const manifest = await response.json();
  assert.equal(manifest.start_url, "/tablet-board/");
  assert.equal(manifest.scope, "/tablet-board/");
  assert.equal(manifest.id, "/tablet-board/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.orientation, "landscape");
  for (const icon of manifest.icons) {
    const image = await get(icon.src);
    assert.equal(image.headers.get("content-type"), "image/png");
    const bytes = Buffer.from(await image.arrayBuffer());
    const size = Number(icon.sizes.split("x")[0]);
    assert.equal(bytes.readUInt32BE(16), size);
    assert.equal(bytes.readUInt32BE(20), size);
  }
  const html = await (await get("/tablet-board/")).text();
  assert.match(html, /rel="manifest" href="\/tablet-board\/manifest.webmanifest"/);
  for (const path of ["/tablet-board/tasks?fixtures=1", "/tablet-board/calendar", "/tablet-board/knowledge"]) {
    assert.equal(await (await get(path)).text(), html);
  }
  const redirect = await get("/?fixtures=1");
  assert.equal(redirect.headers.get("location"), "https://assistant.test/tablet-board/?fixtures=1");
  assert.equal(await (await get("/manifest.webmanifest")).text(), await read("manifest.webmanifest"));
  assert.equal(await (await get("/phone/sw.js")).text(), await read("phone/sw.js"));
  assert.equal(await (await get("/phone/tasks?fixtures=1")).text(), await read("phone/index.html"));
  const sw = await get("/tablet-board/sw.js");
  assert.match(sw.headers.get("content-type"), /text\/javascript/);
  assert.equal(sw.headers.get("cache-control"), "no-store");
  const swSource = await sw.text();
  assert.doesNotMatch(swSource, /__TABLET_SHELL_VERSION__/);
  const harness = workerHarness(swSource);
  let installed;
  harness.handlers.install({ waitUntil: promise => { installed = promise; } });
  await installed;
  for (const path of [...harness.stores.values()][0].keys()) assert.equal((await get(path)).status, 200, path);
  assert.match(await read("tablet-board/board.mjs"), /register\("\/tablet-board\/sw.js", \{ scope: "\/tablet-board\/" \}\)/);
});

test("tablet shell supports offline routes/queries without caching API, phone, or third-party traffic", async () => {
  const { handlers, stores, context, cache } = workerHarness(await read("tablet-board/sw.js"));
  let done;
  handlers.install({ waitUntil: promise => { done = promise; } });
  await done;
  const send = (path, mode = "navigate", method = "GET") => {
    let response;
    handlers.fetch({ request: { url: new URL(path, "https://assistant.test").href, mode, method }, respondWith: promise => { response = promise; } });
    return response;
  };
  for (const path of ["/tablet-board/?fixtures=1", "/tablet-board/tasks?search=a", "/tablet-board/calendar/", "/tablet-board/knowledge"]) {
    assert.equal(await (await send(path)).text(), "/tablet-board/");
  }
  assert.equal(await (await send("/tablet-board/board.mjs", "cors")).text(), "/tablet-board/board.mjs");
  for (const path of ["/api/household-board", "/api/list-tasks", "/phone/", "/tablet-board/missing.mjs", "https://other.test/tablet-board/"]) assert.equal(send(path), undefined);
  assert.equal(send("/api/complete-task", "cors", "POST"), undefined);
  assert.equal(send("/tablet-board/board.mjs?private=1", "cors"), undefined);
  context.fetch = async () => new Response("fresh module");
  assert.equal(await (await send("/tablet-board/board.mjs", "cors")).text(), "fresh module");
  context.fetch = async () => { throw new Error("offline"); };
  assert.equal(await (await send("/tablet-board/board.mjs", "cors")).text(), "fresh module");
  await cache("assistant-ai-phone-shell-v1").addAll(["/phone/"]);
  await cache("assistant-ai-tablet-shell-old").addAll([]);
  handlers.activate({ waitUntil: promise => { done = promise; } });
  await done;
  assert.ok(stores.has("assistant-ai-phone-shell-v1"));
  assert.ok(!stores.has("assistant-ai-tablet-shell-old"));
});
